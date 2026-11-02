import type WebSocket from 'ws';
import type { DashboardPatch, DashboardSnapshot, Envelope, TaskEvent, TaskResult } from '@agentmesh/shared';
import { MESSAGE_TYPES } from '@agentmesh/shared';
import { deviceRegistry, type ConnectionKind } from '../services/deviceRegistry.js';
import { upsertDevice, touchHeartbeat } from '../db/repo/devices.js';
import { upsertAgents } from '../db/repo/agents.js';
import { verifyToken } from '../security/auth.js';
import { getPendingPair } from '../security/pairing.js';

/**
 * 看板 / 网关连接（用于广播 dashboard.patch、wechat.reply 等）。
 */
export interface Peer {
  kind: 'device' | 'dashboard' | 'gateway';
  deviceId?: string;
  socket: WebSocket;
}

/**
 * 任务生命周期桥接接口（由 index.ts 注入 scheduler/taskRunner）。
 * 解耦 transport 与 scheduler 的循环依赖。
 */
export interface TaskBridge {
  /** 设备上报的流式事件 */
  onDeviceTaskEvent(event: TaskEvent): void;
  /** 设备上报的任务结果 */
  onDeviceTaskResult(result: TaskResult): void;
  /** 设备断开时标记其运行中任务为 interrupted */
  onDeviceDisconnected(deviceId: string): void;
}

/** 看板连接集合 */
const dashboards = new Set<WebSocket>();
/** 网关连接集合 */
const gateways = new Set<WebSocket>();
/** 连接类型注册表（socket -> Peer） */
const peers = new Map<WebSocket, Peer>();

let taskBridge: TaskBridge | null = null;

/** 资产分发 ack 处理器（index.ts 注入 deliveryService.handleAssetDeliverAck） */
let assetAckHandler: (ack: unknown) => void = () => {};

/** 注入资产分发 ack 处理器 */
export function setAssetAckHandler(fn: (ack: unknown) => void): void {
  assetAckHandler = fn;
}

/** 快照装配器（index.ts 注入，避免与 scheduler 循环 import） */
let snapshotProvider: (() => DashboardSnapshot) | null = null;
/** 单设备 patch 装配器（index.ts 注入） */
let devicePatchBuilder: ((deviceId: string) => DashboardPatch) | null = null;

/** 注入任务生命周期桥接 */
export function setTaskBridge(bridge: TaskBridge): void {
  taskBridge = bridge;
}

/** 注入快照装配器 */
export function setSnapshotProvider(fn: () => DashboardSnapshot): void {
  snapshotProvider = fn;
}

/** 注入单设备 patch 装配器 */
export function setDevicePatchBuilder(fn: (deviceId: string) => DashboardPatch): void {
  devicePatchBuilder = fn;
}

/** 向看板广播单设备 patch（在线/离线/负载变化） */
function broadcastDevicePatch(deviceId: string): void {
  const patch = devicePatchBuilder?.(deviceId);
  if (!patch) return;
  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: `devpatch-${deviceId}-${Date.now()}`,
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: patch,
  });
}

/** 向指定 socket 发送 Envelope */
export function sendEnvelope(socket: WebSocket, envelope: Envelope): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(envelope));
  }
}

/** 广播给所有看板 */
export function broadcastToDashboards(envelope: Envelope): void {
  for (const s of dashboards) sendEnvelope(s, envelope);
}

/** 广播给所有网关 */
export function broadcastToGateways(envelope: Envelope): void {
  for (const s of gateways) sendEnvelope(s, envelope);
}

/** 向在线设备发送（按连接种类路由：直连 socket 或中继转发） */
export function sendToDevice(deviceId: string, envelope: Envelope): boolean {
  const entry = deviceRegistry.get(deviceId);
  if (!entry) return false;
  if (entry.kind === 'lan' && entry.socket) {
    sendEnvelope(entry.socket, envelope);
    return true;
  }
  if (entry.kind === 'relay') {
    // 经中继转发：relayServer 会按 envelope.to 路由
    relayForwardToDevice(deviceId, envelope);
    return true;
  }
  return false;
}

/** 中继转发占位（index.ts 装配 relayServer 后覆盖实现） */
let relayForwardToDevice: (deviceId: string, envelope: Envelope) => void = () => {
  /* 默认空实现，装配 relay 后替换 */
};

export function setRelayForward(fn: (deviceId: string, envelope: Envelope) => void): void {
  relayForwardToDevice = fn;
}

/**
 * 处理一条来自连接的 Envelope（导出供 lanDiscovery 出站直连复用）。
 */
export function handleEnvelopeFor(
  socket: WebSocket,
  raw: string,
  fallbackPeer?: Peer,
): void {
  handleEnvelope(socket, raw, fallbackPeer);
}

function handleEnvelope(socket: WebSocket, raw: string, fallbackPeer?: Peer): void {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return;
  }
  if (!envelope || typeof envelope.type !== 'string') return;

  const peer = peers.get(socket) ?? fallbackPeer;
  const type = envelope.type as string;

  switch (type) {
    case MESSAGE_TYPES.DEVICE_REGISTER: {
      handleDeviceRegister(socket, envelope, peer);
      break;
    }
    case MESSAGE_TYPES.DEVICE_HEARTBEAT: {
      const hb = envelope.payload as {
        deviceId: string;
        load: { cpu: number; mem: number };
        busyAgents: number;
      };
      if (!hb?.deviceId) return;
      deviceRegistry.heartbeat(hb.deviceId, hb.load ?? { cpu: 0, mem: 0 }, hb.busyAgents ?? 0);
      touchHeartbeat(hb.deviceId);
      broadcastDevicePatch(hb.deviceId);
      break;
    }
    case MESSAGE_TYPES.DEVICE_CAPABILITIES: {
      const caps = envelope.payload as { deviceId: string; agents: unknown[] };
      if (!caps?.deviceId || !Array.isArray(caps.agents)) return;
      upsertAgents(caps.deviceId, caps.agents as never);
      break;
    }
    case MESSAGE_TYPES.TASK_EVENT: {
      taskBridge?.onDeviceTaskEvent(envelope.payload as TaskEvent);
      break;
    }
    case MESSAGE_TYPES.TASK_RESULT: {
      taskBridge?.onDeviceTaskResult(envelope.payload as TaskResult);
      break;
    }
    case MESSAGE_TYPES.ASSET_DELIVER_ACK: {
      assetAckHandler(envelope.payload);
      break;
    }
    case MESSAGE_TYPES.DEVICE_PLATFORM_OPEN_ACK: {
      const ack = envelope.payload as { deviceId?: string; agentType?: string; ok?: boolean; message?: string };
      if (ack?.ok === false) {
        console.warn(`[platform-open] ${ack.deviceId}/${ack.agentType} 打开失败: ${ack.message ?? 'unknown'}`);
      } else {
        console.log(`[platform-open] ${ack.deviceId}/${ack.agentType} 已打开: ${ack.message ?? ''}`);
      }
      break;
    }
    default: {
      // 未知类型：按 03 §6.4 不静默吞，回一个 system 事件
      if (peer?.kind === 'device' && peer.deviceId) {
        sendEnvelope(socket, {
          v: 1,
          type: MESSAGE_TYPES.TASK_EVENT,
          id: `sys-${Date.now()}`,
          ts: Date.now(),
          from: 'coordinator',
          to: peer.deviceId,
          payload: {
            taskId: 'system',
            seq: 0,
            eventType: 'system',
            data: { message: `未知消息类型: ${type}` },
            ts: Date.now(),
          },
        });
      }
    }
  }
}

/** 设备注册处理 */
function handleDeviceRegister(socket: WebSocket, envelope: Envelope, peer?: Peer): void {
  const reg = envelope.payload as {
    deviceId: string;
    name: string;
    hostname: string;
    os: { platform: string; arch: string; release: string };
    version: string;
    token: string;
  };
  if (!reg?.deviceId) return;

  // 首次连接且 token 为空 → 走配对流程
  if (!reg.token) {
    const pending = getPendingPair(reg.deviceId);
    sendEnvelope(socket, {
      v: 1,
      type: MESSAGE_TYPES.DEVICE_PAIR,
      id: `pair-${Date.now()}`,
      ts: Date.now(),
      from: 'coordinator',
      to: reg.deviceId,
      payload: {
        deviceId: reg.deviceId,
        name: reg.name,
        pending: !pending,
        pairingCode: pending?.code,
      },
    });
    return;
  }

  // token 校验（本地开发可配 AGENTMESH_SKIP_AUTH=1 跳过）
  const skipAuth = process.env.AGENTMESH_SKIP_AUTH === '1';
  if (!skipAuth && !verifyToken(reg.deviceId, reg.token)) {
    sendEnvelope(socket, {
      v: 1,
      type: MESSAGE_TYPES.DEVICE_REGISTER_ACK,
      id: `ack-${Date.now()}`,
      ts: Date.now(),
      from: 'coordinator',
      to: reg.deviceId,
      payload: { deviceId: reg.deviceId, accepted: false, reason: 'token_invalid', paired: false },
    });
    return;
  }

  // 入站 /ws 设备连接为局域网直连（relay 路径经 relayClient 单独登记）
  const kind: ConnectionKind = 'lan';
  deviceRegistry.register(reg.deviceId, reg.name, kind, { socket });
  peers.set(socket, { kind: 'device', deviceId: reg.deviceId, socket });

  const remoteAddr = (socket as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress;
  upsertDevice({
    deviceId: reg.deviceId,
    name: reg.name,
    hostname: reg.hostname,
    os: reg.os,
    version: reg.version,
    token: reg.token,
    lanAddr: remoteAddr,
  });

  broadcastDevicePatch(reg.deviceId);

  sendEnvelope(socket, {
    v: 1,
    type: MESSAGE_TYPES.DEVICE_REGISTER_ACK,
    id: `ack-${Date.now()}`,
    ts: Date.now(),
    from: 'coordinator',
    to: reg.deviceId,
    payload: { deviceId: reg.deviceId, accepted: true, paired: true },
  });
}

/**
 * 处理一条新 WebSocket 连接（wsServer 入口）。
 */
export function handleConnection(
  socket: WebSocket,
  query: { type?: string; deviceId?: string } = {},
): void {
  const kind: Peer['kind'] =
    query.type === 'dashboard' ? 'dashboard' : query.type === 'gateway' ? 'gateway' : 'device';

  if (kind === 'dashboard') {
    dashboards.add(socket);
    peers.set(socket, { kind, socket });
    // 看板首次连接立即下发全量快照
    const snapshot = snapshotProvider?.();
    if (snapshot) {
      sendEnvelope(socket, {
        v: 1,
        type: MESSAGE_TYPES.DASHBOARD_SNAPSHOT,
        id: `snapshot-${Date.now()}`,
        ts: Date.now(),
        from: 'coordinator',
        to: 'dashboard',
        payload: snapshot,
      });
    }
  } else if (kind === 'gateway') {
    gateways.add(socket);
    peers.set(socket, { kind, socket });
  } else if (kind === 'device') {
    // 设备连接：可能是「经中继」或「直连」；注册时再确定
    peers.set(socket, { kind: 'device', deviceId: query.deviceId, socket });
  }

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const text = Buffer.isBuffer(data)
      ? data.toString('utf-8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf-8')
        : Buffer.concat(data).toString('utf-8');
    handleEnvelope(socket, text);
  });

  socket.on('close', () => {
    const peer = peers.get(socket);
    if (peer?.kind === 'dashboard') dashboards.delete(socket);
    if (peer?.kind === 'gateway') gateways.delete(socket);
    if (peer?.kind === 'device' && peer.deviceId) {
      taskBridge?.onDeviceDisconnected(peer.deviceId);
      broadcastDevicePatch(peer.deviceId);
    }
    peers.delete(socket);
  });

  socket.on('error', () => {
    /* close 事件会处理清理 */
  });
}
