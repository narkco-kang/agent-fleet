import type {
  AgentType,
  CancelReason,
  Origin,
  TargetMode,
  TaskEventType,
  TaskResultStatus,
  TaskStatus,
} from './status.js';

/** 任务下发 payload（task.submit） */
export interface TaskSubmit {
  taskId: string;
  sessionId: string;
  origin: Origin;
  originRef: string;
  prompt: string;
  target: TaskTarget;
  options: TaskOptions;
  /** 蜂群角色 persona 注入上下文（可选；设备侧合并到 prompt 前缀） */
  systemPrompt?: string;
  /** 投递幂等键（P1-5）：协调器重发同一任务时，设备按它去重，避免重复执行 */
  operationId?: string;
  createdAt: number;
}

/** 路由目标 */
export interface TaskTarget {
  mode: TargetMode;
  deviceId?: string;
  agentType?: AgentType;
  /** mode='role' 时的角色名 */
  role?: string;
  /** mode='team' 时的团队 id（不同团队负责不同需求） */
  teamId?: string;
  /** mode='swarm' 时的蜂群角色团队 id */
  roleTeamId?: string;
  /** mode='swarm' 时的子角色 slug */
  subRole?: string;
  requireCapability?: string;
  /**
   * 平台内的 bot 名（如 grok 的自定义 agent：explore/plan/reviewer）。
   * 不传 = 平台自动委派：grok 走 general-purpose 主 agent，自行 spawn 子代理并行处理。
   */
  agentProfile?: string;
}

/** 三态沙箱（P0-2）：默认 none，高危子角色开 readonly/isolated */
export type SandboxProfile = 'none' | 'readonly' | 'isolated';

/** 任务选项 */
export interface TaskOptions {
  maxTurns?: number;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  allowList?: string[];
  denyList?: string[];
  /** 沙箱隔离级别（P0-2，默认 none；readonly=只读文件系统，isolated=只读+断网） */
  sandbox?: SandboxProfile;
}

/** 流式事件 payload（task.event） */
export interface TaskEvent {
  taskId: string;
  /** 单调递增序号，用于排序/丢包检测 */
  seq: number;
  eventType: TaskEventType;
  status?: TaskStatus;
  data: TaskEventData;
  ts: number;
}

/** 事件数据 */
export interface TaskEventData {
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  message?: string;
  delta?: string;
}

/** 任务取消 payload（task.cancel） */
export interface TaskCancel {
  taskId: string;
  reason: CancelReason;
}

/** 任务结果 payload（task.result） */
export interface TaskResult {
  taskId: string;
  status: TaskResultStatus;
  result: TaskResultBody;
  logs: string[];
  finishedAt: number;
}

/** 结果体 */
export interface TaskResultBody {
  text: string;
  exitCode: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
  /** 失败原因透传（failed 时的错误信息） */
  error?: string;
}

/** 任务下发确认（task.submit_ack） */
export interface TaskSubmitAck {
  taskId: string;
  accepted: boolean;
  reason?: string;
  deviceId?: string;
  agentType?: AgentType;
  queued?: boolean;
}

/** 看板快照中的任务节点 */
export interface TaskSnapshot {
  taskId: string;
  sessionId: string;
  origin: Origin;
  prompt: string;
  status: TaskStatus;
  targetMode: TargetMode;
  targetDeviceId?: string | null;
  targetAgentType?: AgentType | null;
  targetRole?: string | null;
  targetTeamId?: string | null;
  /** mode='swarm' 时的蜂群角色团队 id */
  targetRoleTeamId?: string | null;
  /** mode='swarm' 时的子角色 slug */
  targetSubRole?: string | null;
  /** mode='group' 时的设备分组标签 */
  targetGroup?: string | null;
  /** 平台内的 bot 名（如 grok 自定义 agent） */
  agentProfile?: string | null;
  resultText?: string | null;
  durationMs?: number | null;
  createdAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
}
