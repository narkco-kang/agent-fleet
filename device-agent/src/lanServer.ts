import { WebSocketServer, type WebSocket } from 'ws';
import type { Envelope } from '@agentmesh/shared';
import { handleEnvelope, sendRegister, sendCapabilities } from './messageHandler.js';
import { addSender, removeSender, type Sender } from './senderRegistry.js';
import { config } from './config.js';

/**
 * 设备本地 WS Server：接收协调服务直连。
 * 连接建立后 → 主动 register + 上报能力；后续心跳定时广播。
 */
export interface LanServerHandle {
  port: number;
  stop(): void;
}

export function startLanServer(): Promise<LanServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '0.0.0.0', port: config.port }, () => {
      const address = wss.address();
      const port = typeof address === 'object' && address ? address.port : config.port;
      resolve({
        port,
        stop: () => wss.close(),
      });
    });

    wss.on('error', (err) => reject(err));

    wss.on('connection', (socket: WebSocket) => {
      const remote = (socket as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress ?? 'unknown';
      const sender: Sender = {
        label: `lan-${remote}`,
        send: (env: Envelope) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(env));
        },
      };
      addSender(sender);

      // 连接建立即注册 + 上报能力
      sendRegister((env) => sender.send(env));
      void sendCapabilities((env) => sender.send(env));

      socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        const text = Buffer.isBuffer(data)
          ? data.toString('utf-8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf-8')
            : Buffer.concat(data).toString('utf-8');
        try {
          const env = JSON.parse(text) as Envelope;
          void handleEnvelope(env, (resp) => sender.send(resp));
        } catch {
          /* 忽略非法消息 */
        }
      });

      socket.on('close', () => removeSender(sender));
      socket.on('error', () => removeSender(sender));
    });
  });
}
