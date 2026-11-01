import type { AgentType, TargetMode, TaskStatus } from '@agentmesh/shared';
import { MESSAGE_TYPES } from '@agentmesh/shared';
import { deviceRegistry } from './deviceRegistry.js';
import {
  assignTaskTarget,
  createTask,
  listTasks,
  updateTaskStatus,
} from '../db/repo/tasks.js';
import type { AgentRow } from '../db/repo/agents.js';
import { claimAgent, releaseAgent, listAgents } from '../db/repo/agents.js';
import { listPrimaryAgents } from '../db/repo/devices.js';
import { broadcastToDashboards, sendToDevice } from '../transport/wsServer.js';
import { roleRouter } from './routing/roleRouter.js';
import { modelGatewayClient, type ChatMessage } from './routing/modelGatewayClient.js';
import { recordUsage } from './routing/usageLedger.js';
import type { RoleRoutingDecision } from '@agentmesh/shared';

/**
 * 任务调度器：路由决策（auto/device/agent）+ 认领/限流（max_agents）。
 *
 * 借鉴 grok cursor-worker 的「worker 注册 + 认领 + max_agents 限流」范式：
 *  - 每个 agent 的占用 = 当前 running 任务数；
 *  - max_concurrency 上限内才认领，超限任务保持 queued。
 */

interface DeviceAgent {
  deviceId: string;
  agent: AgentRow;
}

/** 任务下发输入（来自 REST/微信） */
export interface SchedulerSubmitInput {
  taskId: string;
  sessionId: string;
  origin: 'dashboard' | 'wechat_personal' | 'wechat_work';
  originRef: string;
  prompt: string;
  targetMode: TargetMode;
  targetDeviceId?: string;
  targetAgentType?: AgentType;
  targetRole?: string;
  requireCapability?: string;
}

/** 设备占用计数 */
const deviceBusy = new Map<string, number>();

/** 经 modelgateway 执行的任务结果 */
export interface GatewayTaskResult {
  status: TaskStatus;
  resultText: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs: number;
  error?: string;
}

/** 调度器回调（由 index 注入 taskRunner） */
export interface SchedulerHooks {
  onDispatched: (taskId: string, deviceId: string, agentType: AgentType) => void;
  onEvent: (taskId: string, eventType: string, status: TaskStatus, data: Record<string, unknown>) => void;
  /** 角色路由 → 网关路径：开始执行 */
  onGatewayDispatched?: (taskId: string, modelRef: string) => void;
  /** 角色路由 → 网关路径：执行完成 */
  onGatewayCompleted?: (taskId: string, result: GatewayTaskResult) => void;
}

let hooks: SchedulerHooks | null = null;

export function setSchedulerHooks(h: SchedulerHooks): void {
  hooks = h;
}

/**
 * 创建并排队任务（写库 + 尝试立即派发）。
 */
export function enqueueTask(input: SchedulerSubmitInput): string {
  createTask({
    taskId: input.taskId,
    sessionId: input.sessionId,
    origin: input.origin,
    originRef: input.originRef,
    prompt: input.prompt,
    targetMode: input.targetMode,
    targetDeviceId: input.targetDeviceId ?? null,
    targetAgentType: input.targetAgentType ?? null,
    targetRole: input.targetRole ?? null,
    requireCapability: input.requireCapability ?? null,
  });
  dispatch();
  return input.taskId;
}

/**
 * 派发循环：为 queued 任务找到可用设备/agent 并下发。
 */
export function dispatch(): void {
  const queued = listTasks({ status: 'queued' });
  for (const task of queued) {
    // 角色路由 → 网关路径（不占用设备/agent 认领）
    if (task.target_mode === 'role' && task.target_role) {
      const decision = roleRouter.decide(task.target_role, { taskId: task.task_id });
      if (decision?.viaGateway) {
        dispatchGatewayTask(task, decision);
        continue;
      }
    }

    const target = pickTarget(task);
    if (!target) continue; // 暂无可用设备/agent，保持 queued

    const { deviceId, agent } = target;
    if (!claimAgent(deviceId, agent.agent_type)) continue; // 认领失败，保持 queued

    const deviceName = deviceRegistry.get(deviceId)?.name ?? deviceId;
    assignTaskTarget(task.task_id, deviceId, agent.agent_type);
    updateTaskStatus(task.task_id, 'running', { started_at: Date.now() });
    incBusy(deviceId);
    syncRegistryBusy();

    // 下发 task.submit 给设备
    const envelope = {
      v: 1 as const,
      type: MESSAGE_TYPES.TASK_SUBMIT,
      id: `submit-${task.task_id}`,
      ts: Date.now(),
      from: 'coordinator',
      to: deviceId,
      payload: {
        taskId: task.task_id,
        sessionId: task.session_id,
        origin: task.origin,
        originRef: task.origin_ref,
        prompt: task.prompt,
        target: {
          mode: task.target_mode,
          deviceId,
          agentType: agent.agent_type,
          requireCapability: task.require_capability ?? undefined,
        },
        options: {},
        createdAt: task.created_at,
      },
    };
    sendToDevice(deviceId, envelope);

    hooks?.onDispatched(task.task_id, deviceId, agent.agent_type);
    hooks?.onEvent(task.task_id, 'status', 'running', {
      message: `已分配到 ${deviceName} · ${agent.display_name}`,
    });

    broadcastToDashboards({
      v: 1,
      type: MESSAGE_TYPES.DASHBOARD_PATCH,
      id: `patch-${Date.now()}`,
      ts: Date.now(),
      from: 'coordinator',
      to: 'dashboard',
      payload: {
        kind: 'patch',
        tasks: [{ taskId: task.task_id, status: 'running' }],
        ts: Date.now(),
      },
    });
  }
}

/**
 * 路由决策：为任务选择目标设备/agent。
 */
function pickTarget(task: {
  task_id: string;
  target_mode: TargetMode;
  target_device_id: string | null;
  target_agent_type: AgentType | null;
  target_role: string | null;
  require_capability: string | null;
}): DeviceAgent | null {
  const pairs = onlineDeviceAgents();
  if (pairs.length === 0) return null;

  // 角色路由 → 本地 agent 路径
  if (task.target_mode === 'role' && task.target_role) {
    const decision = roleRouter.decide(task.target_role, { taskId: task.task_id });
    if (!decision || decision.viaGateway) return null;
    const { deviceId, agentType } = decision.resolved;
    if (!deviceId || !agentType) return null;
    const candidate = pairs.find(
      (p) => p.deviceId === deviceId && p.agent.agent_type === agentType,
    );
    return candidate ?? null;
  }

  if (task.target_mode === 'device' && task.target_device_id) {
    const candidates = pairs.filter(
      (p) => p.deviceId === task.target_device_id && agentMatches(p.agent, task.target_agent_type ?? null, task.require_capability),
    );
    return pickBest(candidates);
  }
  if (task.target_mode === 'agent' && task.target_agent_type) {
    const candidates = pairs.filter(
      (p) => p.agent.agent_type === task.target_agent_type && agentMatches(p.agent, task.target_agent_type, task.require_capability),
    );
    return pickBest(candidates);
  }
  // auto：优先设备主 agent（若设置了），其次空闲优先
  const candidates = pairs.filter((p) =>
    agentMatches(p.agent, task.target_agent_type, task.require_capability),
  );
  const primaryAgents = listPrimaryAgents();
  const primaryCandidates = candidates.filter(
    (p) => primaryAgents.get(p.deviceId) === p.agent.agent_type,
  );
  return pickBest(primaryCandidates.length > 0 ? primaryCandidates : candidates);
}

/** agent 是否匹配类型 + 能力约束 */
function agentMatches(
  agent: AgentRow,
  requiredType: AgentType | null,
  requireCapability: string | null,
): boolean {
  if (requiredType && agent.agent_type !== requiredType) return false;
  if (requireCapability) {
    const caps = JSON.parse(agent.capabilities || '[]') as string[];
    if (!caps.includes(requireCapability)) return false;
  }
  return true;
}

/** 空闲优先选择：占用最低、负载最低 */
function pickBest(candidates: DeviceAgent[]): DeviceAgent | null {
  if (candidates.length === 0) return null;
  return candidates
    .filter((p) => p.agent.status !== 'error')
    .sort((a, b) => {
      const busyA = busyOf(a.deviceId, a.agent.agent_type);
      const busyB = busyOf(b.deviceId, b.agent.agent_type);
      if (busyA !== busyB) return busyA - busyB;
      const loadA = deviceRegistry.get(a.deviceId)?.load.cpu ?? 1;
      const loadB = deviceRegistry.get(b.deviceId)?.load.cpu ?? 1;
      return loadA - loadB;
    })[0] ?? null;
}

/** 在线设备 + 其 agent 组合 */
function onlineDeviceAgents(): DeviceAgent[] {
  const onlineIds = new Set(deviceRegistry.onlineIds());
  const agents = listAgents();
  return agents
    .filter((a: AgentRow) => onlineIds.has(a.device_id))
    .map((agent: AgentRow) => ({ deviceId: agent.device_id, agent }));
}

/** 认领占用计数 */
function busyOf(deviceId: string, agentType: AgentType): number {
  // 直接用 DB busy_count（agents 表）
  const agent = listAgents().find(
    (a: AgentRow) => a.device_id === deviceId && a.agent_type === agentType,
  );
  return agent?.busy_count ?? 0;
}

/** 释放占用（任务结束后） */
export function release(deviceId: string, agentType: AgentType): void {
  releaseAgent(deviceId, agentType);
  syncRegistryBusy();
  // 释放后尝试派发排队任务
  setImmediate(dispatch);
}

/** 设备 busy 计数 */
function incBusy(deviceId: string): void {
  deviceBusy.set(deviceId, (deviceBusy.get(deviceId) ?? 0) + 1);
}

/** 获取设备占用计数（快照用） */
export function getBusyCount(deviceId: string): number {
  return deviceBusy.get(deviceId) ?? 0;
}

/** 同步 busy 到注册表（心跳上报用） */
function syncRegistryBusy(): void {
  for (const [deviceId, n] of deviceBusy) {
    const entry = deviceRegistry.get(deviceId);
    if (entry) entry.busyAgents = n;
  }
}

/** 定时派发（兜底：处理设备上线/agent 释放后未及时派发的队列） */
export function startDispatchLoop(): void {
  setInterval(() => dispatch(), 2_000).unref();
}

/** 角色路由 → 网关路径：标记 running 并触发 modelgateway 执行 */
function dispatchGatewayTask(
  task: {
    task_id: string;
    session_id: string;
    prompt: string;
  },
  decision: RoleRoutingDecision,
): void {
  const modelRef = decision.resolved.modelRef ?? decision.resolved.botName ?? 'gateway';
  const startedAt = Date.now();
  updateTaskStatus(task.task_id, 'running', { started_at: startedAt });
  hooks?.onGatewayDispatched?.(task.task_id, modelRef);
  hooks?.onEvent(task.task_id, 'status', 'running', { message: `经模型网关执行 · ${modelRef}` });
  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: `patch-${Date.now()}`,
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: { kind: 'patch', tasks: [{ taskId: task.task_id, status: 'running' }], ts: Date.now() },
  });

  void executeGatewayTask(task, decision, modelRef, startedAt)
    .then((result) => hooks?.onGatewayCompleted?.(task.task_id, result))
    .catch((err) => {
      hooks?.onGatewayCompleted?.(task.task_id, {
        status: 'failed',
        resultText: '',
        durationMs: Date.now() - startedAt,
        error: (err as Error).message,
      });
    });
}

/** 调用 modelgateway（非流式）+ 台账 */
async function executeGatewayTask(
  task: { task_id: string; session_id: string; prompt: string },
  decision: RoleRoutingDecision,
  modelRef: string,
  startedAt: number,
): Promise<GatewayTaskResult> {
  const messages: ChatMessage[] = [{ role: 'user', content: task.prompt }];
  const response = await modelGatewayClient.chatCompletions({
    model: modelRef,
    messages,
    stream: false,
    sessionId: task.session_id,
    agent: decision.resolved.botName,
    taskId: task.task_id,
  });

  const tokensIn = response.usage?.prompt_tokens;
  const tokensOut = response.usage?.completion_tokens;
  recordUsage({
    taskId: task.task_id,
    provider: response.provider ?? null,
    model: response.model ?? modelRef,
    tokensIn: tokensIn ?? null,
    tokensOut: tokensOut ?? null,
  });

  return {
    status: 'completed',
    resultText: response.text,
    tokensIn,
    tokensOut,
    durationMs: Date.now() - startedAt,
  };
}
