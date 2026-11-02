import type { AgentType, TargetMode, TaskStatus } from '@agentfleet/shared';
import { MESSAGE_TYPES } from '@agentfleet/shared';
import { deviceRegistry } from './deviceRegistry.js';
import {
  assignTaskTarget,
  createTask,
  listTasks,
  updateTaskStatus,
} from '../db/repo/tasks.js';
import type { AgentRow } from '../db/repo/agents.js';
import { claimAgent, releaseAgent, listAgents } from '../db/repo/agents.js';
import { listDevicesByTeam, listPrimaryAgents } from '../db/repo/devices.js';
import { getTeam } from '../db/repo/teams.js';
import { broadcastToDashboards, sendToDevice } from '../transport/wsServer.js';
import { roleRouter } from './routing/roleRouter.js';
import { modelGatewayClient, type ChatMessage } from './routing/modelGatewayClient.js';
import { recordUsage } from './routing/usageLedger.js';
import { isFreeSourceRef } from './routing/freeSourceService.js';
import { directFreeChat } from '@agentfleet/shared';
import * as platformModelService from './routing/platformModelService.js';
import type { PlatformModelBinding, RoleRoutingDecision } from '@agentfleet/shared';

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
  targetTeamId?: string;
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
    targetTeamId: input.targetTeamId ?? null,
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
    // 1) 先尝试本地设备/团队（本地优先，避免有设备却走网关）
    const target = pickTarget(task);
    if (!target) {
      // 2) 本地无可用目标 → 角色/团队路由是否可降级到网关
      const decision = resolveGatewayDecision(task);
      if (decision?.viaGateway) {
        dispatchGatewayTask(task, decision);
      }
      continue; // 均不可用，保持 queued
    }

    const { deviceId, agent } = target;

    // 平台模型绑定：该设备+agent 配置了网关模型 → 经网关执行（故障自动切换兜底，全失败降级本地）
    const binding = platformModelService.resolve(deviceId, agent.agent_type);
    if (binding && modelGatewayClient.isAvailable()) {
      dispatchPlatformGatewayTask(task, deviceId, agent.agent_type, binding);
      continue;
    }

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
export function pickTarget(task: {
  task_id: string;
  target_mode: TargetMode;
  target_device_id: string | null;
  target_agent_type: AgentType | null;
  target_role: string | null;
  target_team_id?: string | null;
  require_capability: string | null;
}): DeviceAgent | null {
  const pairs = onlineDeviceAgents();
  if (pairs.length === 0) return null;

  // 团队模式：只在团队绑定的设备上选目标（A 设备=软件开发团队，B 设备=内容专家团队）
  if (task.target_mode === 'team') {
    return pickTeamTarget(task, pairs);
  }

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

/**
 * 团队模式选目标：
 * 1) 团队绑定设备（devices.team_id）+ 成员显式 deviceId 的并集；
 * 2) 若任务指定 role，优先该角色成员（deviceId + agentType）；
 * 3) 否则按团队成员顺序找可用者；
 * 4) 最后在该团队设备上按空闲/负载择优。
 */
function pickTeamTarget(
  task: {
    target_agent_type: AgentType | null;
    target_role: string | null;
    target_team_id?: string | null;
    require_capability: string | null;
  },
  pairs: DeviceAgent[],
): DeviceAgent | null {
  if (!task.target_team_id) return null;
  const team = getTeam(task.target_team_id);
  if (!team) return null;

  const teamDevices = new Set(listDevicesByTeam(team.id));
  for (const m of team.members) if (m.deviceId) teamDevices.add(m.deviceId);
  if (teamDevices.size === 0) return null;

  const roles = task.target_role
    ? [task.target_role]
    : Array.from(new Set(team.members.map((m) => m.role)));

  for (const role of roles) {
    const member = team.members.find((m) => m.role === role && m.deviceId);
    const boundDevice = member?.deviceId ?? team.routes[role]?.deviceId;
    if (!boundDevice || !teamDevices.has(boundDevice)) continue;
    const agentType = member?.agentType ?? team.routes[role]?.agentType ?? task.target_agent_type;
    const candidates = pairs.filter(
      (p) =>
        p.deviceId === boundDevice &&
        (!agentType || p.agent.agent_type === agentType) &&
        agentMatches(p.agent, task.target_agent_type, task.require_capability),
    );
    const best = pickBest(candidates);
    if (best) return best;
  }

  // 兜底：团队绑定设备上的任意可用 agent
  const candidates = pairs.filter(
    (p) => teamDevices.has(p.deviceId) && agentMatches(p.agent, task.target_agent_type, task.require_capability),
  );
  return pickBest(candidates);
}

/** 角色/团队模式 → 网关降级决策（本地无可用目标时才调用） */
function resolveGatewayDecision(task: {
  task_id: string;
  target_mode: TargetMode;
  target_role: string | null;
  target_team_id?: string | null;
}): RoleRoutingDecision | null {
  if (task.target_mode === 'role' && task.target_role) {
    return roleRouter.decide(task.target_role, { taskId: task.task_id });
  }
  if (task.target_mode === 'team' && task.target_team_id) {
    const team = getTeam(task.target_team_id);
    if (!team) return null;
    const role = task.target_role ?? team.members[0]?.role;
    if (!role) return null;
    return roleRouter.decide(role, { taskId: task.task_id }, team.routes);
  }
  return null;
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

  let response;
  try {
    response = await modelGatewayClient.chatCompletions({
      model: modelRef,
      messages,
      stream: false,
      sessionId: task.session_id,
      agent: decision.resolved.botName,
      taskId: task.task_id,
    });
  } catch (err) {
    // 免费源兜底：modelgateway 免费线路不可用（如 ALL_FAILED）时，直连公开免密上游
    if (!isFreeSourceRef(modelRef)) throw err;
    const direct = await directFreeChat({
      sourceId: 'kilo-free',
      model: modelRef.includes('kilo-auto/free') ? 'kilo-auto/free' : undefined,
      messages,
    });
    if (!direct.ok) {
      throw new Error(`modelgateway: ${(err as Error).message}; direct free: ${direct.error}`);
    }
    recordUsage({
      taskId: task.task_id,
      provider: direct.provider ?? 'kilo-free',
      model: modelRef,
      tokensIn: direct.usage?.prompt_tokens ?? null,
      tokensOut: direct.usage?.completion_tokens ?? null,
    });
    return {
      status: 'completed',
      resultText: direct.text,
      tokensIn: direct.usage?.prompt_tokens,
      tokensOut: direct.usage?.completion_tokens,
      durationMs: Date.now() - startedAt,
    };
  }

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

/**
 * 平台模型绑定 → 网关执行：主模型失败自动切换兜底；全部失败降级本地（任务回到 queued）。
 */
function dispatchPlatformGatewayTask(
  task: {
    task_id: string;
    session_id: string;
    prompt: string;
  },
  deviceId: string,
  agentType: AgentType,
  binding: PlatformModelBinding,
): void {
  const startedAt = Date.now();
  const modelRef = binding.activeModel;
  updateTaskStatus(task.task_id, 'running', { started_at: startedAt });
  hooks?.onEvent(task.task_id, 'status', 'running', {
    message: `经网关执行 · ${deviceId}/${agentType} → ${modelRef}`,
  });
  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: `patch-${Date.now()}`,
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: { kind: 'patch', tasks: [{ taskId: task.task_id, status: 'running' }], ts: Date.now() },
  });

  void executePlatformGatewayTask(task, deviceId, agentType, binding, startedAt)
    .then((result) => {
      if (result.requeue) {
        // 全部模型失败：降级本地，让下一轮 dispatch 走本地 agent
        updateTaskStatus(task.task_id, 'queued');
        return;
      }
      hooks?.onGatewayCompleted?.(task.task_id, result.completed as GatewayTaskResult);
    })
    .catch((err) => {
      hooks?.onGatewayCompleted?.(task.task_id, {
        status: 'failed',
        resultText: '',
        durationMs: Date.now() - startedAt,
        error: (err as Error).message,
      });
    });
}

type PlatformGatewayOutcome = { completed?: GatewayTaskResult; requeue?: boolean };

/** 依 activeModel + 兜底顺序逐个尝试；失败则 markModelFailed 自动切换 */
async function executePlatformGatewayTask(
  task: { task_id: string; session_id: string; prompt: string },
  deviceId: string,
  agentType: AgentType,
  binding: PlatformModelBinding,
  startedAt: number,
): Promise<PlatformGatewayOutcome> {
  const messages: ChatMessage[] = [{ role: 'user', content: task.prompt }];
  const order = Array.from(
    new Set([binding.activeModel, ...binding.fallbacks, binding.model]),
  );

  for (const model of order) {
    try {
      const response = await modelGatewayClient.chatCompletions({
        model,
        messages,
        stream: false,
        sessionId: task.session_id,
        agent: `${deviceId}/${agentType}`,
        taskId: task.task_id,
      });
      const tokensIn = response.usage?.prompt_tokens;
      const tokensOut = response.usage?.completion_tokens;
      recordUsage({
        taskId: task.task_id,
        provider: response.provider ?? null,
        model: response.model ?? model,
        tokensIn: tokensIn ?? null,
        tokensOut: tokensOut ?? null,
      });
      if (model !== binding.activeModel) {
        platformModelService.switchModel(deviceId, agentType, model);
      }
      return {
        completed: {
          status: 'completed',
          resultText: response.text,
          tokensIn,
          tokensOut,
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (err) {
      platformModelService.markModelFailed(deviceId, agentType, model);
    }
  }

  // 全部失败：降级本地（下一轮 dispatch 走本地 agent 路径）
  return { requeue: true, completed: undefined };
}
