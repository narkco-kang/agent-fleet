import type { DashboardPatch, DashboardSnapshot, Envelope } from '@agentfleet/shared';
import { MESSAGE_TYPES, WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS } from '@agentfleet/shared';

/**
 * WS 客户端：连接、心跳、断线重连、snapshot/patch 事件分发到 zustand store。
 */
export type SnapshotHandler = (snapshot: DashboardSnapshot) => void;
export type PatchHandler = (patch: DashboardPatch) => void;

/** 设备登录授权消息（看板授权中心） */
export interface LoginChallengeMsg {
  deviceId: string;
  agentType: string;
  url: string;
  code: string;
}
export interface LoginResultMsg {
  deviceId: string;
  agentType: string;
  status: 'success' | 'timeout' | 'cancelled' | 'failed';
  message?: string;
}
export type LoginMessage =
  | { kind: 'challenge'; data: LoginChallengeMsg }
  | { kind: 'result'; data: LoginResultMsg };
export type LoginHandler = (msg: LoginMessage) => void;

const WS_BASE = (import.meta.env.VITE_WS_BASE as string | undefined) ?? 'ws://127.0.0.1:4173/ws';

let ws: WebSocket | null = null;
let reconnectDelay = WS_RECONNECT_BASE_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualClose = false;

const snapshotHandlers = new Set<SnapshotHandler>();
const patchHandlers = new Set<PatchHandler>();
const loginHandlers = new Set<LoginHandler>();
const stateHandlers = new Set<(state: 'connecting' | 'open' | 'closed') => void>();

/** 订阅快照 */
export function onSnapshot(h: SnapshotHandler): () => void {
  snapshotHandlers.add(h);
  return () => snapshotHandlers.delete(h);
}

/** 订阅 patch */
export function onPatch(h: PatchHandler): () => void {
  patchHandlers.add(h);
  return () => patchHandlers.delete(h);
}

/** 订阅设备登录授权消息（challenge/result） */
export function onLogin(h: LoginHandler): () => void {
  loginHandlers.add(h);
  return () => loginHandlers.delete(h);
}

/** 订阅连接状态 */
export function onWsState(h: (state: 'connecting' | 'open' | 'closed') => void): () => void {
  stateHandlers.add(h);
  return () => stateHandlers.delete(h);
}

function setState(state: 'connecting' | 'open' | 'closed'): void {
  for (const h of stateHandlers) h(state);
}

/** 建立 WS 连接 */
export function connectWs(): void {
  manualClose = false;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  setState('connecting');
  const url = `${WS_BASE}?type=dashboard`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectDelay = WS_RECONNECT_BASE_MS;
    setState('open');
  };

  ws.onmessage = (ev: MessageEvent<string>) => {
    let env: Envelope;
    try {
      env = JSON.parse(ev.data) as Envelope;
    } catch {
      return;
    }
    if (env.type === MESSAGE_TYPES.DASHBOARD_SNAPSHOT) {
      for (const h of snapshotHandlers) h(env.payload as DashboardSnapshot);
    } else if (env.type === MESSAGE_TYPES.DASHBOARD_PATCH) {
      for (const h of patchHandlers) h(env.payload as DashboardPatch);
    } else if (env.type === MESSAGE_TYPES.DEVICE_LOGIN_CHALLENGE) {
      for (const h of loginHandlers) h({ kind: 'challenge', data: env.payload as LoginChallengeMsg });
    } else if (env.type === MESSAGE_TYPES.DEVICE_LOGIN_RESULT) {
      for (const h of loginHandlers) h({ kind: 'result', data: env.payload as LoginResultMsg });
    }
  };

  ws.onclose = () => {
    setState('closed');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (manualClose || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
    reconnectDelay = Math.min(reconnectDelay * 2, WS_RECONNECT_MAX_MS);
  }, reconnectDelay);
}

/** 手动关闭 */
export function closeWs(): void {
  manualClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

/** 发送信封（看板 → 协调） */
export function sendWs(envelope: Envelope): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
  }
}
