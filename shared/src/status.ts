/**
 * 状态枚举 —— 四处引用同一份（见 03 §6.2 / 12 §6.2）
 *
 * 路由网关融合 + 六大新功能新增枚举统一在此维护，协议文件（routing/asset/
 * deploy/team/loop/action）只 import 不重复定义，保证单一事实源。
 */

/** 任务六态 */
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** 设备三态 */
export type DeviceStatus = 'online' | 'busy' | 'offline';

/** Agent 三态（+ needs_login：已安装但尚未登录激活） */
export type AgentStatus = 'available' | 'busy' | 'error' | 'needs_login';

/** 任务流式事件类型 */
export type TaskEventType =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'system'
  | 'status';

/** 任务发起入口 */
export type Origin = 'dashboard' | 'wechat_personal' | 'wechat_work';

/** Agent 平台类型（主流国内外 AI agent CLI/平台） */
export type AgentType =
  | 'codex'
  | 'claude'
  | 'dsh'
  | 'grok'
  | 'cursor'
  | 'aider'
  | 'gemini'
  | 'cody'
  | 'qwen'
  | 'doubao'
  | 'kimi'
  | 'opencode'
  | 'windsurf'
  | 'workbuddy';

/** 路由模式（扩展 role：角色路由；team：按设备团队模式路由；swarm：蜂群角色团队路由） */
export type TargetMode = 'auto' | 'device' | 'agent' | 'role' | 'team' | 'swarm';

/** 任务取消原因 */
export type CancelReason = 'user_cancel' | 'timeout' | 'device_offline' | 'system';

/** 任务结果状态 */
export type TaskResultStatus = 'completed' | 'failed' | 'interrupted';

/** 资产类型（规则 / 资料库 / skills） */
export type AssetKind = 'rule' | 'knowledge' | 'skill';

/** 资产内容形态（MVP 只用 text，P1 扩展 file） */
export type AssetContentType = 'text' | 'file';

/** 资产分发状态 */
export type DeliveryStatus =
  | 'pending'
  | 'confirmed'
  | 'sending'
  | 'delivered'
  | 'failed';

/** 部署目标 OS */
export type DeployOS = 'macos' | 'windows' | 'linux' | 'unknown';

/** 部署目标状态机 */
export type DeployTargetStatus =
  | 'pending'
  | 'connecting'
  | 'probing'
  | 'installing'
  | 'verifying'
  | 'success'
  | 'failed';

/** 部署批次状态 */
export type DeploymentBatchStatus =
  | 'pending_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Loop 编排状态 */
export type LoopState =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Loop 触发方式（MVP 仅 manual） */
export type LoopTrigger = 'manual' | 'schedule' | 'event';

/** 对外动作类型（一律过 actionGuard） */
export type ActionKind = 'deploy' | 'uninstall' | 'asset_deliver' | 'loop_start';

/** 人工确认记录状态 */
export type ActionStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'executed'
  | 'expired';

/** 角色能力（chat / 仅决策） */
export type RoleCapability = 'chat' | 'decision-only';

/** 免费源评级（优 > 中 > 差；仅保留优与中） */
export type FreeSourceRating = 'excellent' | 'medium' | 'poor';

export const FREE_SOURCE_RATINGS: readonly FreeSourceRating[] = [
  'excellent',
  'medium',
  'poor',
] as const;export const TASK_STATUSES: readonly TaskStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export const DEVICE_STATUSES: readonly DeviceStatus[] = ['online', 'busy', 'offline'] as const;

export const AGENT_STATUSES: readonly AgentStatus[] = ['available', 'busy', 'error', 'needs_login'] as const;

export const TASK_EVENT_TYPES: readonly TaskEventType[] = [
  'text',
  'thinking',
  'tool_call',
  'tool_result',
  'system',
  'status',
] as const;

export const AGENT_TYPES: readonly AgentType[] = [
  'codex',
  'claude',
  'dsh',
  'grok',
  'cursor',
  'aider',
  'gemini',
  'cody',
  'qwen',
  'doubao',
  'kimi',
  'opencode',
  'windsurf',
  'workbuddy',
] as const;

export const TARGET_MODES: readonly TargetMode[] = ['auto', 'device', 'agent', 'role', 'team', 'swarm'] as const;

export const ASSET_KINDS: readonly AssetKind[] = ['rule', 'knowledge', 'skill'] as const;

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'confirmed',
  'sending',
  'delivered',
  'failed',
] as const;

export const DEPLOY_OSES: readonly DeployOS[] = ['macos', 'windows', 'linux', 'unknown'] as const;

export const DEPLOY_TARGET_STATUSES: readonly DeployTargetStatus[] = [
  'pending',
  'connecting',
  'probing',
  'installing',
  'verifying',
  'success',
  'failed',
] as const;

export const DEPLOYMENT_BATCH_STATUSES: readonly DeploymentBatchStatus[] = [
  'pending_confirmation',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export const LOOP_STATES: readonly LoopState[] = [
  'idle',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;

export const LOOP_TRIGGERS: readonly LoopTrigger[] = ['manual', 'schedule', 'event'] as const;

export const ACTION_KINDS: readonly ActionKind[] = [
  'deploy',
  'uninstall',
  'asset_deliver',
  'loop_start',
] as const;

export const ACTION_STATUSES: readonly ActionStatus[] = [
  'pending_confirmation',
  'confirmed',
  'rejected',
  'executed',
  'expired',
] as const;

export const ROLE_CAPABILITIES: readonly RoleCapability[] = ['chat', 'decision-only'] as const;

/** 终态集合（任务不再流转） */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

/** 资产分发终态 */
export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['delivered', 'failed'] as const;

/** 部署目标终态 */
export const TERMINAL_DEPLOY_TARGET_STATUSES: readonly DeployTargetStatus[] = [
  'success',
  'failed',
] as const;

/** Loop 终态 */
export const TERMINAL_LOOP_STATES: readonly LoopState[] = [
  'completed',
  'failed',
  'cancelled',
] as const;

/** 判断给定任务状态是否为终态 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

/** 判断给定分发状态是否为终态 */
export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return (TERMINAL_DELIVERY_STATUSES as readonly string[]).includes(status);
}

/** 判断给定部署目标状态是否为终态 */
export function isTerminalDeployTargetStatus(status: DeployTargetStatus): boolean {
  return (TERMINAL_DEPLOY_TARGET_STATUSES as readonly string[]).includes(status);
}

/** 判断给定 Loop 状态是否为终态 */
export function isTerminalLoopState(state: LoopState): boolean {
  return (TERMINAL_LOOP_STATES as readonly string[]).includes(state);
}
