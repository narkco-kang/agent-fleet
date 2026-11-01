import WebSocket from 'ws';
import type { Envelope } from '@agentmesh/shared';
import { config } from '../config.js';

/**
 * 协调服务作为客户端出站连中继（云端兜底）。
 * 当设备经中继在线时，协调服务通过此连接向设备透传信封。
 */

let relaySocket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectDelay = 1_000;

/** 中继消息处理器（由 index.ts 注入，处理 device.relay_online/offline 与业务转发） */
let onRelayMessage: (env: Envelope) => void = () => {};

export function setRelayMessageHandler(fn: (env: Envelope) => void): void {
  onRelayMessage = fn;
}

/** 出站连接中继 */
export function connectRelay(): void {
  if (!config.relayUrl) return;
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) return;

  const url = new URL(config.relayUrl);
  url.searchParams.set('role', 'coordinator');
  if (config.relaySecret) url.searchParams.set('secret', config.relaySecret);

  let socket: WebSocket;
  try {
    socket = new WebSocket(url.toString());
  } catch (err) {
    console.warn('[relay-client] 连接中继失败:', (err as Error).message);
    scheduleReconnect();
    return;
  }

  socket.on('open', () => {
    reconnectDelay = 1_000;
    relaySocket = socket;
    console.log(`[relay-client] 协调服务已出站连接中继 ${url.toString()}`);
  });

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const text = Buffer.isBuffer(data)
      ? data.toString('utf-8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf-8')
        : Buffer.concat(data).toString('utf-8');
    try {
      onRelayMessage(JSON.parse(text) as Envelope);
    } catch {
      /* 忽略非法消息 */
    }
  });

  socket.on('close', () => {
    relaySocket = null;
    scheduleReconnect();
  });

  socket.on('error', () => {
    socket.close();
  });
}

/** 经中继向设备发送信封 */
export function relaySend(deviceId: string, envelope: Envelope): void {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    relaySocket.send(JSON.stringify({ ...envelope, to: deviceId }));
  }
}

/** 协调服务是否已连中继 */
export function isRelayConnected(): boolean {
  return !!relaySocket && relaySocket.readyState === WebSocket.OPEN;
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
