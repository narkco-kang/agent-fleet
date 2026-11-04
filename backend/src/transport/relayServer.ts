import { WebSocketServer, type WebSocket } from 'ws';
import type { Envelope } from '@agentfleet/shared';
import { config } from '../config.js';

/**
 * 云端 WS 中继：纯透传，不解析、不落业务数据。
 *
 * 连接协议：
 *  - 设备出站：  ws://relay/ws?role=device&deviceId=xxx
 *  - 协调出站：  ws://relay/ws?role=coordinator
 *
 * 路由规则：
 *  - 收到 {to: deviceId} → 转发给该 device 连接
 *  - 收到 {to: coordinator} 或 {from: deviceId} → 转发给 coordinator 连接
 *
 * 依赖边界：独立 relay 进程（relayEntry）不持有 deviceRegistry（那属于协调器进程），
 * 设备经中继上/下线只通过 device.relay_online/offline 消息通知协调器；
 * 仅当 backend 同进程内嵌中继（RELAY_IN_PROCESS=1）时，才通过注入 hook 直接登记本地 registry。
 */

interface RelayPeer {
  role: 'device' | 'coordinator';
  deviceId?: string;
  socket: WebSocket;
}

/** deviceId → 设备连接 */
const deviceSockets = new Map<string, WebSocket>();
/** 协调服务连接 */
const coordinatorSockets = new Set<WebSocket>();

/** 同进程本地登记 hook（backend 内嵌中继时注入；独立 relay 进程不注入，保持零原生依赖） */
let onDeviceRelayOnline: ((deviceId: string) => void) | null = null;
let onDeviceRelayOffline: ((deviceId: string) => void) | null = null;

/** 注入「设备经中继上/下线」的本地登记回调（backend 同进程中继时调用） */
export function setRelayLocalHooks(
  online: (deviceId: string) => void,
  offline: (deviceId: string) => void,
): void {
  onDeviceRelayOnline = online;
  onDeviceRelayOffline = offline;
}

/** 中继服务实例 */
export function createRelayServer(): { wss: WebSocketServer; close: () => void } {
  const wss = new WebSocketServer({ host: config.relayHost, port: config.relayPort });

  wss.on('connection', (socket: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const role = url.searchParams.get('role') === 'coordinator' ? 'coordinator' : 'device';
    const deviceId = url.searchParams.get('deviceId') ?? undefined;
    // 可选鉴权 secret（若配置了 RELAY_SECRET）
    const secret = url.searchParams.get('secret') ?? '';
    if (config.relaySecret && secret !== config.relaySecret) {
      socket.close(4001, 'invalid secret');
      return;
    }

    const peer: RelayPeer = { role, deviceId, socket };

    if (role === 'device' && deviceId) {
      deviceSockets.set(deviceId, socket);
      // 通知协调服务：该设备经中继在线
      notifyCoordinatorOnline(deviceId);
    } else if (role === 'coordinator') {
      coordinatorSockets.add(socket);
    }

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf-8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf-8')
          : Buffer.concat(data).toString('utf-8');
      let env: Envelope;
      try {
        env = JSON.parse(text) as Envelope;
      } catch {
        return;
      }
      route(env, socket);
    });

    socket.on('close', () => {
      if (peer.role === 'device' && peer.deviceId) {
        if (deviceSockets.get(peer.deviceId) === socket) deviceSockets.delete(peer.deviceId);
        notifyCoordinatorOffline(peer.deviceId);
      } else if (peer.role === 'coordinator') {
        coordinatorSockets.delete(socket);
      }
    });

    socket.on('error', () => {
      /* close 处理清理 */
    });
  });

  return {
    wss,
    close: () => {
      for (const s of deviceSockets.values()) s.close();
      for (const s of coordinatorSockets) s.close();
      deviceSockets.clear();
      coordinatorSockets.clear();
      wss.close();
    },
  };
}

/** 按 to/from 路由透传 */
function route(env: Envelope, from: WebSocket): void {
  // 设备 → 协调：from 是 deviceId
  if (env.to === 'coordinator') {
    for (const c of coordinatorSockets) {
      if (c.readyState === c.OPEN) c.send(JSON.stringify(env));
    }
    return;
  }
  // 协调 → 设备：to 是 deviceId
  if (env.to && env.to !== 'dashboard' && env.to !== 'wechat') {
    const target = deviceSockets.get(env.to);
    if (process.env.AGENTFLEET_DEBUG_RELAY === '1') {
      console.log(`[relay-route] to=${env.to} type=${env.type} target=${target ? 'found' : 'MISSING'} targetOpen=${target ? target.readyState : 'n/a'}`);
    }
    if (target && target !== from && target.readyState === target.OPEN) {
      target.send(JSON.stringify(env));
    }
    return;
  }
  // 兜底：转发给协调服务
  for (const c of coordinatorSockets) {
    if (c !== from && c.readyState === c.OPEN) c.send(JSON.stringify(env));
  }
}

/** 设备经中继上线：通知协调服务注册 */
function notifyCoordinatorOnline(deviceId: string): void {
  for (const c of coordinatorSockets) {
    if (c.readyState === c.OPEN) {
      c.send(
        JSON.stringify({
          v: 1,
          type: 'device.relay_online',
          id: `relay-${Date.now()}`,
          ts: Date.now(),
          from: 'relay',
          to: 'coordinator',
          payload: { deviceId },
        }),
      );
    }
  }
  // 同进程场景直接登记（仅 backend 内嵌中继时注入 hook）
  onDeviceRelayOnline?.(deviceId);
}

/** 设备经中继下线：通知协调服务 */
function notifyCoordinatorOffline(deviceId: string): void {
  for (const c of coordinatorSockets) {
    if (c.readyState === c.OPEN) {
      c.send(
        JSON.stringify({
          v: 1,
          type: 'device.relay_offline',
          id: `relay-${Date.now()}`,
          ts: Date.now(),
          from: 'relay',
          to: 'coordinator',
          payload: { deviceId },
        }),
      );
    }
  }
  // 同进程场景直接清理
  onDeviceRelayOffline?.(deviceId);
}
