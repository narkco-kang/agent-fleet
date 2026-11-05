import type WebSocket from 'ws';
import type { DashboardPatch, DashboardSnapshot, Envelope, TaskEvent, TaskResult } from '@agentfleet/shared';
import { MESSAGE_TYPES } from '@agentfleet/shared';
import { deviceRegistry, type ConnectionKind } from '../services/deviceRegistry.js';
import { upsertDevice, touchHeartbeat } from '../db/repo/devices.js';
import { upsertAgents, setAgentActivated } from '../db/repo/agents.js';
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
  /** 设备上报的流式事件（fromDeviceId 供跨设备伪造防御） */
  onDeviceTaskEvent(event: TaskEvent, fromDeviceId?: string): void;
  /** 设备上报的任务结果（fromDeviceId 供跨设备伪造防御） */
  onDeviceTaskResult(result: TaskResult, fromDeviceId?: string): void;
  /** 设备断开时标记其运行中任务为 interrupted */
  onDeviceDisconnected(deviceId: string): void;
  /** 设备上报决策门（P0-5：任务 blocked 等人类选择） */
  onDecisionGate?(taskId: string, title: string, options: string[]): void;
}

/** 跳过设备 token 鉴权（本地开发/测试用）。兼容历史名 AGENTMESH_SKIP_AUTH（项目曾名 AgentMesh）
 *  与现名 AGENTFLEET_SKIP_AUTH，避免改名后误用旧名导致鉴权未跳过。 */
const SKIP_AUTH = process.env.AGENTMESH_SKIP_AUTH === '1' || process.env.AGENTFLEET_SKIP_AUTH === '1';

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

/** 记忆同步消息处理器（index.ts 注入 memorySync.handleMemorySyncMessage） */
let memorySyncHandler: (
  type: string,
  fromDeviceId: string,
  payload: Record<string, unknown>,
) => void | Promise<void> = () => {};

/** 注入记忆同步消息处理器 */
export function setMemorySyncHandler(
  fn: (type: string, fromDeviceId: string, payload: Record<string, unknown>) => void | Promise<void>,
): void {
  memorySyncHandler = fn;
}

/** coordinator 公钥提供者（index.ts 注入 memoryLedger，随设备注册下发给设备验签） */
let coordinatorKeyProvider: () => string | null = () => null;

/** 注入 coordinator 公钥提供者 */
export function setCoordinatorKeyProvider(fn: () => string | null): void {
  coordinatorKeyProvider = fn;
}

/** 快照装配器（index.ts 注入，避免与 scheduler 循环 import） */
let snapshotProvider: (() => DashboardSnapshot) | null = null;
/** 单设备 patch 装配器（index.ts 注入） */
let devicePatchBuilder: ((deviceId: string) => DashboardPatch) | null = null;

/** 注入任务生命周期桥接 */
export function setTaskBridge(bridge: TaskBridge): void {
  taskBridge = bridge;
}

/** 通知设备断连（供 lanDiscovery 反向连接的 close 复用，统一标 interrupted + 移除） */
export function notifyDeviceDisconnected(deviceId: string): void {
  taskBridge?.onDeviceDisconnected(deviceId);
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

  // 记忆同步消息：memory.* 转交 memorySync 处理器（chain_summary / block_request）
  if (type.startsWith('memory.')) {
    void memorySyncHandler(type, envelope.from, (envelope.payload ?? {}) as Record<string, unknown>);
    return;
  }

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
      taskBridge?.onDeviceTaskEvent(envelope.payload as TaskEvent, peer?.deviceId ?? envelope.from);
      break;
    }
    case MESSAGE_TYPES.TASK_RESULT: {
      taskBridge?.onDeviceTaskResult(envelope.payload as TaskResult, peer?.deviceId ?? envelope.from);
      break;
    }
    case MESSAGE_TYPES.DECISION_GATE: {
      const gate = envelope.payload as { taskId?: string; title?: string; options?: string[] };
      if (gate?.taskId) {
        taskBridge?.onDecisionGate?.(gate.taskId, gate.title ?? '', gate.options ?? []);
      }
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
      } else if (ack?.deviceId && ack?.agentType) {
        // 打开平台应用成功 → 标记该 agent 为已激活（用户在该应用内完成登录）
        setAgentActivated(ack.deviceId, ack.agentType as never, true);
        broadcastDevicePatch(ack.deviceId);
        console.log(`[platform-open] ${ack.deviceId}/${ack.agentType} 已打开并标记激活: ${ack.message ?? ''}`);
      }
      break;
    }
    case MESSAGE_TYPES.DEVICE_LOGIN_CHALLENGE:
    case MESSAGE_TYPES.DEVICE_LOGIN_RESULT: {
      handleDeviceLoginMessage(type, envelope.payload);
      break;
    }
    case MESSAGE_TYPES.DEVICE_MODEL_CONFIG_ACK: {
      handleDeviceModelConfigAck(type, envelope.payload);
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

  // token 校验（本地开发可配 AGENTMESH_SKIP_AUTH=1 / AGENTFLEET_SKIP_AUTH=1 跳过）
  if (!SKIP_AUTH && !verifyToken(reg.deviceId, reg.token)) {
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
    payload: {
      deviceId: reg.deviceId,
      accepted: true,
      paired: true,
      coordinatorPublicKey: coordinatorKeyProvider() ?? undefined,
    },
  });
}

/**
 * 处理经中继转发的设备消息（真实远程设备场景：无直连 socket，回执经 relayForwardToDevice）。
 * 复用直连场景的注册/能力/心跳逻辑，仅发送通道不同（relay 无 socket、无 lanAddr）。
 */
export function handleRelayEnvelope(env: Envelope): void {
  const type = env.type as string;
  const payload = env.payload as Record<string, unknown> | undefined;

  if (type === MESSAGE_TYPES.DEVICE_REGISTER) {
    const reg = payload as {
      deviceId: string;
      name: string;
      hostname: string;
      os: { platform: string; arch: string; release: string };
      version: string;
      token: string;
    };
    if (!reg?.deviceId) return;

    // token 校验（与直连一致，SKIP_AUTH 跳过）
    if (!SKIP_AUTH && !verifyToken(reg.deviceId, reg.token)) {
      relayForwardToDevice(reg.deviceId, {
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

    try {
      deviceRegistry.register(reg.deviceId, reg.name, 'relay');
      upsertDevice({
        deviceId: reg.deviceId,
        name: reg.name,
        hostname: reg.hostname,
        os: reg.os,
        version: reg.version,
        token: reg.token,
      });
    } catch (err) {
      console.error('[relay-register] 处理失败:', (err as Error).message, 'payload=', JSON.stringify(reg));
    }
    broadcastDevicePatch(reg.deviceId);
    relayForwardToDevice(reg.deviceId, {
      v: 1,
      type: MESSAGE_TYPES.DEVICE_REGISTER_ACK,
      id: `ack-${Date.now()}`,
      ts: Date.now(),
      from: 'coordinator',
      to: reg.deviceId,
      payload: {
        deviceId: reg.deviceId,
        accepted: true,
        paired: true,
        coordinatorPublicKey: coordinatorKeyProvider() ?? undefined,
      },
    });
    return;
  }

  if (type === MESSAGE_TYPES.DEVICE_CAPABILITIES) {
    const caps = payload as { deviceId: string; agents: unknown[] };
    if (!caps?.deviceId || !Array.isArray(caps.agents)) return;
    upsertAgents(caps.deviceId, caps.agents as never);
    return;
  }

  if (type === MESSAGE_TYPES.DEVICE_HEARTBEAT) {
    const hb = payload as { deviceId: string; load: { cpu: number; mem: number }; busyAgents: number };
    if (!hb?.deviceId) return;
    deviceRegistry.heartbeat(hb.deviceId, hb.load ?? { cpu: 0, mem: 0 }, hb.busyAgents ?? 0);
    touchHeartbeat(hb.deviceId);
    broadcastDevicePatch(hb.deviceId);
    return;
  }

  // 设备登录授权挑战/结果（看板授权中心）：转发看板 + 成功后标记 agent 激活
  handleDeviceLoginMessage(type, payload);
  // 一键配置模型回执：转发看板 + 成功后标记 agent 激活
  handleDeviceModelConfigAck(type, payload);
}

/** 处理设备登录授权消息（challenge/result），直连与中继路径共用 */
function handleDeviceLoginMessage(type: string, payload: unknown): boolean {
  if (type === MESSAGE_TYPES.DEVICE_LOGIN_CHALLENGE) {
    const c = payload as { deviceId?: string; agentType?: string; url?: string; code?: string };
    if (!c?.url || !c?.code) return false;
    broadcastToDashboards({
      v: 1,
      type: MESSAGE_TYPES.DEVICE_LOGIN_CHALLENGE,
      id: `lc-${Date.now()}`,
      ts: Date.now(),
      from: c.deviceId ?? 'device',
      to: 'dashboard',
      payload: c,
    });
    return true;
  }
  if (type === MESSAGE_TYPES.DEVICE_LOGIN_RESULT) {
    const r = payload as { deviceId?: string; agentType?: string; status?: string; message?: string };
    broadcastToDashboards({
      v: 1,
      type: MESSAGE_TYPES.DEVICE_LOGIN_RESULT,
      id: `lr-${Date.now()}`,
      ts: Date.now(),
      from: r.deviceId ?? 'device',
      to: 'dashboard',
      payload: r,
    });
    // 登录成功 → 标记该 agent 已激活（用户已授权）+ 广播设备快照更新，前端实时刷新「未激活」状态
    if (r?.status === 'success' && r.deviceId && r.agentType) {
      setAgentActivated(r.deviceId, r.agentType as never, true);
      broadcastDevicePatch(r.deviceId);
    }
    return true;
  }
  return false;
}

/** 处理一键配置模型回执（转发看板 + 成功标记激活），直连与中继路径共用 */
function handleDeviceModelConfigAck(type: string, payload: unknown): boolean {
  if (type !== MESSAGE_TYPES.DEVICE_MODEL_CONFIG_ACK) return false;
  const ack = payload as { deviceId?: string; agentType?: string; ok?: boolean; message?: string };
  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DEVICE_MODEL_CONFIG_ACK,
    id: `mc-${Date.now()}`,
    ts: Date.now(),
    from: ack.deviceId ?? 'device',
    to: 'dashboard',
    payload: ack,
  });
  // 配置成功 → 标记该 agent 已激活（已配好自定义模型，免登录）+ 广播设备快照更新
  if (ack?.ok && ack.deviceId && ack.agentType) {
    setAgentActivated(ack.deviceId, ack.agentType as never, true);
    broadcastDevicePatch(ack.deviceId);
  }
  return true;
}

/** ws 探活间隔：每 PING_INTERVAL_MS 发一次 ping，一次未回 pong 即判定死连接 */
const PING_INTERVAL_MS = 1_500;

/**
 * 给设备连接加 ws ping/pong 探活（TCP 半开连接下最快的断连检测手段）。
 * SIGKILL 强杀对端时 socket 的 close 事件可能长期不触发（TCP keepalive 默认 2h），
 * 靠应用层心跳兜底太慢；ws ping/pong 可在约 2×PING_INTERVAL 内识别死连接并 terminate。
 */
function armPingPong(socket: WebSocket): void {
  const alive = { value: true };
  socket.on('pong', () => {
    alive.value = true;
  });
  const timer = setInterval(() => {
    if (!alive.value) {
      socket.terminate();
      return;
    }
    alive.value = false;
    try {
      socket.ping();
    } catch {
      /* ignore */
    }
  }, PING_INTERVAL_MS);
  timer.unref();
  socket.on('close', () => clearInterval(timer));
}

/** 供 lanDiscovery 反向连接复用探活 */
export function armDevicePingPong(socket: WebSocket): void {
  armPingPong(socket);
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
    armPingPong(socket);
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
