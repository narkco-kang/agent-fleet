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

/** 登录授权请求（device.login_request：coordinator → 设备，让设备对指定平台发起 device-auth 登录） */
export interface DeviceLoginRequest {
  deviceId: string;
  agentType: AgentType;
}

/** 登录授权挑战（device.login_challenge：设备 → coordinator，回传浏览器授权 URL + 一次性码） */
export interface DeviceLoginChallenge {
  deviceId: string;
  agentType: AgentType;
  /** 浏览器授权 URL（用户打开并登录） */
  url: string;
  /** 一次性授权码（用户输入） */
  code: string;
  /** 已授权（平台此前已登录，无需再次授权） */
  alreadyAuthed?: boolean;
}

/** 登录授权结果（device.login_result：设备 → coordinator，device-auth 轮询的最终结果） */
export interface DeviceLoginResult {
  deviceId: string;
  agentType: AgentType;
  status: 'success' | 'timeout' | 'cancelled' | 'failed';
  message?: string;
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

/** 平台内的 bot（自定义 agent，如 grok 的 explore/plan/reviewer） */
export interface AgentBot {
  name: string;
  description: string;
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
  /** 是否已登录激活（可选；设备侧不报时由协调器管理，默认未激活） */
  activated?: boolean;
  /** 平台内的可选 bot 列表（如 grok 自定义 agent） */
  bots?: AgentBot[];
}

/** 探测方式 */
export type DetectMethod = 'path' | 'which' | 'default_dir' | 'npm' | 'app';

/** 打开平台应用请求（协调 → 设备，用户登录激活平台） */
export interface PlatformOpen {
  deviceId: string;
  agentType: AgentType;
}

/** 打开平台应用回执（设备 → 协调） */
export interface PlatformOpenAck {
  deviceId: string;
  agentType: AgentType;
  ok: boolean;
  /** 实际执行的启动命令（诊断用） */
  command?: string;
  message?: string;
}

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
  /** 该设备绑定的蜂群角色团队（swarm 模式路由用，未绑定则为 null） */
  roleTeamId?: string | null;
  /** 蜂群角色团队展示名（快照冗余，便于前端直接展示） */
  roleTeamName?: string | null;
  /** 设备分组标签（群组感知，group 模式路由用，空字符串 = 未分组） */
  groupName?: string | null;
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
  /** 是否已登录激活（false = 需登录激活后才能接任务） */
  activated: boolean;
  /** 平台内的可选 bot 列表（如 grok 自定义 agent） */
  bots: AgentBot[];
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
