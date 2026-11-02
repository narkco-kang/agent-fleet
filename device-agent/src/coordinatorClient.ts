import WebSocket from 'ws';
import type { Envelope } from '@agentfleet/shared';
import { handleEnvelope, sendRegister, sendCapabilities } from './messageHandler.js';
import { addSender, type Sender } from './senderRegistry.js';
import { config } from './config.js';
import { loadRegistry } from './registry.js';

/**
 * 协调服务出站直连（mDNS 不可用时的降级通道）。
 *
 * 沙箱受限场景：mDNS 广播失败时，若配置 COORDINATOR_URL，
 * 设备主动连协调服务的 /ws?type=device，注册 + 心跳 + 能力上报
 * 与局域网直连行为完全一致（复用 handleEnvelope）。
 */
let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = 1_000;

export function connectCoordinator(): void {
  if (!config.coordinatorUrl) return;
  if (socket && socket.readyState === WebSocket.OPEN) return;

  const { deviceId } = loadRegistry();
  const url = new URL(config.coordinatorUrl);
  url.pathname = url.pathname === '/' ? '/ws' : url.pathname;
  url.searchParams.set('type', 'device');
  url.searchParams.set('deviceId', deviceId);

  try {
    socket = new WebSocket(url.toString());
  } catch (err) {
    console.warn('[coordinator-client] 连接协调服务失败:', (err as Error).message);
    scheduleReconnect();
    return;
  }

  socket.on('open', () => {
    reconnectDelay = 1_000;
    const sender: Sender = {
      label: 'coordinator',
      send: (env: Envelope) => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(env));
      },
    };
    addSender(sender);
    sendRegister((env) => sender.send(env));
    void sendCapabilities((env) => sender.send(env));
    console.log(`[coordinator-client] 已出站直连协调服务 ${url.toString()}`);
  });

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const text = Buffer.isBuffer(data)
      ? data.toString('utf-8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf-8')
        : Buffer.concat(data).toString('utf-8');
    try {
      const env = JSON.parse(text) as Envelope;
      void handleEnvelope(env, (resp) => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(resp));
      });
    } catch {
      /* 忽略非法消息 */
    }
  });

  socket.on('close', () => {
    socket = null;
    scheduleReconnect();
  });

  socket.on('error', () => {
    socket?.close();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectCoordinator();
    reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
  }, reconnectDelay);
  reconnectTimer.unref();
}
