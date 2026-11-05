import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRelayServer } from '../src/transport/relayServer.js';
import { config } from '../src/config.js';

/**
 * 中继补发测试：coordinator 晚于设备上线才连接时，必须补发 device.relay_online，
 * 否则设备在协调器看来永久 offline（真实多机测试踩过：设备 6:35 上线、backend 11:55 才启动）。
 */
describe('relay 补发在线设备给晚连的 coordinator', () => {
  let close: () => void;
  let port: number;

  beforeEach(async () => {
    port = 20000 + Math.floor(Math.random() * 20000);
    config.relayPort = port;
    config.relayHost = '127.0.0.1';
    config.relaySecret = '';
    const srv = createRelayServer();
    close = srv.close;
    await new Promise<void>((r) => srv.wss.once('listening', r));
  });

  afterEach(() => {
    close();
  });

  it('设备先上线、coordinator 后连 → 补发 device.relay_online', async () => {
    // 1) 设备先连（此时无 coordinator）
    const dev = new WebSocket(`ws://127.0.0.1:${port}/ws?role=device&deviceId=dev-late`);
    await new Promise<void>((r) => dev.once('open', r));

    // 2) coordinator 后连
    const coord = new WebSocket(`ws://127.0.0.1:${port}/ws?role=coordinator`);
    const msgs: Array<{ type: string; payload?: { deviceId?: string } }> = [];
    coord.on('message', (d) => {
      try {
        msgs.push(JSON.parse(d.toString()) as { type: string; payload?: { deviceId?: string } });
      } catch {
        /* ignore */
      }
    });
    await new Promise<void>((r) => coord.once('open', r));

    // 3) 等补发
    await new Promise<void>((r) => setTimeout(r, 200));

    const online = msgs.find((m) => m.type === 'device.relay_online' && m.payload?.deviceId === 'dev-late');
    expect(online).toBeTruthy();

    dev.close();
    coord.close();
  });

  it('coordinator 先连、设备后连 → 设备连接时正常通知（不重复）', async () => {
    const coord = new WebSocket(`ws://127.0.0.1:${port}/ws?role=coordinator`);
    const msgs: Array<{ type: string; payload?: { deviceId?: string } }> = [];
    coord.on('message', (d) => {
      try {
        msgs.push(JSON.parse(d.toString()) as { type: string; payload?: { deviceId?: string } });
      } catch {
        /* ignore */
      }
    });
    await new Promise<void>((r) => coord.once('open', r));

    const dev = new WebSocket(`ws://127.0.0.1:${port}/ws?role=device&deviceId=dev-early`);
    await new Promise<void>((r) => dev.once('open', r));
    await new Promise<void>((r) => setTimeout(r, 200));

    const onlineMsgs = msgs.filter((m) => m.type === 'device.relay_online' && m.payload?.deviceId === 'dev-early');
    expect(onlineMsgs).toHaveLength(1);

    dev.close();
    coord.close();
  });
});
