import WebSocket from 'ws';
import type { Envelope } from '@agentmesh/shared';
import { handleEnvelope, sendRegister, sendCapabilities } from './messageHandler.js';
import { addSender, removeSender, type Sender } from './senderRegistry.js';
import { config } from './config.js';
import { loadRegistry } from './registry.js';

/**
 * 设备出站连中继（云端兜底）：与 lanServer 共用同一 handleEnvelope。
 */
let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = 1_000;

export function connectRelay(): void {
  if (!config.relayUrl) return;
  if (socket && socket.readyState === WebSocket.OPEN) return;

  const { deviceId } = loadRegistry();
  const url = new URL(config.relayUrl);
  url.searchParams.set('role', 'device');
  url.searchParams.set('deviceId', deviceId);

  try {
    socket = new WebSocket(url.toString());
  } catch (err) {
    console.warn('[relay-client] 连接中继失败:', (err as Error).message);
    scheduleReconnect();
    return;
  }

  socket.on('open', () => {
    reconnectDelay = 1_000;
    const sender: Sender = {
      label: 'relay',
      send: (env: Envelope) => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(env));
      },
    };
    addSender(sender);
    sendRegister((env) => sender.send(env));
    void sendCapabilities((env) => sender.send(env));
    console.log(`[relay-client] 已出站连接中继 ${url.toString()}`);
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
    connectRelay();
    reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
  }, reconnectDelay);
  reconnectTimer.unref();
}
