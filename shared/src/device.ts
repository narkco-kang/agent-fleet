import type { AgentStatus, AgentType, DeviceStatus } from './status.js';

/** 设备注册 payload（device.register） */
export interface DeviceRegister {
  deviceId: string;
  name: string;
  hostname: string;
  os: DeviceOS;
  version: string;
  token: string;
}

/** 设备操作系统信息 */
export interface DeviceOS {
  platform: string;
  arch: string;
  release: string;
}

/** 注册确认（device.register_ack） */
export interface DeviceRegisterAck {
  deviceId: string;
  accepted: boolean;
  reason?: string;
  /** 已配对（无需再走 pair 流程） */
  paired: boolean;
}

/** 设备心跳 payload（device.heartbeat，10s） */
export interface DeviceHeartbeat {
  deviceId: string;
  load: DeviceLoad;
  busyAgents: number;
  ts: number;
}

/** 负载（0~1） */
export interface DeviceLoad {
  cpu: number;
  mem: number;
}

/** 设备能力上报 payload（device.capabilities） */
export interface DeviceCapabilities {
  deviceId: string;
  agents: AgentInfo[];
  ts: number;
}

/** 单个 agent 能力 */
export interface AgentInfo {
  agentType: AgentType;
  displayName: string;
  version: string;
  executable: string;
  status: AgentStatus;
  detectMethod: DetectMethod;
  capabilities: string[];
  maxConcurrency: number;
}

/** 探测方式 */
export type DetectMethod = 'path' | 'which' | 'default_dir' | 'npm' | 'app';

/** 配对请求（device.pair） */
export interface DevicePair {
  deviceId: string;
  name: string;
  pairingCode?: string;
}

/** 配对确认（device.pair_ack） */
export interface DevicePairAck {
  deviceId: string;
  accepted: boolean;
  token?: string;
  reason?: string;
}

/** 看板快照中的设备节点 */
export interface DeviceSnapshot {
  deviceId: string;
  name: string;
  hostname: string;
  osPlatform: string;
  osArch: string;
  status: DeviceStatus;
  lastHeartbeat: number | null;
  lanAddr?: string | null;
  relayOnline: boolean;
  /** 该设备的主 AI agent（auto 路由优先，未设置则为 null） */
  primaryAgentType?: AgentType | null;
  /** 该设备绑定的团队（团队模式路由用，未绑定则为 null） */
  teamId?: string | null;
  /** 团队展示名（快照冗余，便于前端直接展示） */
  teamName?: string | null;
  load: DeviceLoad;
  busyAgents: number;
}

/** 看板快照中的 agent 节点 */
export interface AgentSnapshot {
  deviceId: string;
  agentType: AgentType;
  displayName: string;
  version: string;
  executable: string;
  status: AgentStatus;
  capabilities: string[];
  maxConcurrency: number;
  busyCount: number;
}

/** 看板全量快照 */
export interface DashboardSnapshot {
  kind: 'snapshot';
  devices: DeviceSnapshot[];
  agents: AgentSnapshot[];
  tasks: import('./task.js').TaskSnapshot[];
  relayOnline: boolean;
  ts: number;
}

/** 看板增量 patch（只含变化实体） */
export interface DashboardPatch {
  kind: 'patch';
  devices?: DeviceSnapshot[];
  agents?: AgentSnapshot[];
  tasks?: import('./task.js').TaskSnapshot[];
  events?: import('./task.js').TaskEvent[];
  relayOnline?: boolean;
  ts: number;
}
