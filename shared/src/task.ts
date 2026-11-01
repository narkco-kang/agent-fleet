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
  createdAt: number;
}

/** 路由目标 */
export interface TaskTarget {
  mode: TargetMode;
  deviceId?: string;
  agentType?: AgentType;
  /** mode='role' 时的角色名 */
  role?: string;
  requireCapability?: string;
}

/** 任务选项 */
export interface TaskOptions {
  maxTurns?: number;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  allowList?: string[];
  denyList?: string[];
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
  resultText?: string | null;
  durationMs?: number | null;
  createdAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
}
