import type { AgentType, TaskEvent, TaskEventType, TaskResult, TaskStatus } from '@agentfleet/shared';
import { MESSAGE_TYPES } from '@agentfleet/shared';
import { deviceRegistry } from './deviceRegistry.js';
import { getTask, listTasks, setTaskResult, updateTaskStatus } from '../db/repo/tasks.js';
import { appendMessage } from '../db/repo/messages.js';
import { release, enqueueTask, type SchedulerSubmitInput, type GatewayTaskResult } from './scheduler.js';
import { setSchedulerHooks } from './scheduler.js';
import { sendToDevice, broadcastToDashboards, broadcastToGateways } from '../transport/wsServer.js';
import { taskEventPatch, taskStatusPatch } from './snapshot.js';
import { randomId } from '../security/auth.js';
import { memoryLedger } from './memoryLedger.js';

/**
 * 任务生命周期编排：状态机流转 + 超时 + 断线标记（interrupted）。
 *
 * 状态机：queued → running → completed | failed | cancelled | interrupted
 * 每步落库，错误不静默吞（03 §6.4）。
 */

interface RunningTask {
  deviceId: string;
  agentType: AgentType;
  timer: NodeJS.Timeout | null;
  startedAt: number;
}

const running = new Map<string, RunningTask>();

/** 每任务严格递增的消息序号（时间线回放排序依赖） */
const seqByTask = new Map<string, number>();

function nextSeq(taskId: string): number {
  const n = (seqByTask.get(taskId) ?? 0) + 1;
  seqByTask.set(taskId, n);
  return n;
}

/** 默认任务超时 */
const DEFAULT_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS ?? 600_000);

/** 初始化：把调度器 hooks 指向本 runner */
export function initTaskRunner(): void {
  setSchedulerHooks({
    onDispatched: (taskId, deviceId, agentType) => {
      armTimeout(taskId);
      running.set(taskId, {
        deviceId,
        agentType,
        timer: null,
        startedAt: Date.now(),
      });
    },
    onEvent: (taskId, eventType, status, data) => {
      emitEvent(taskId, eventType as TaskEventType, status, data);
    },
    onGatewayDispatched: (taskId, modelRef) => {
      // 网关任务无设备/agent，仅记录模型 ref（timeout 由 emitEvent 已覆盖）
      void modelRef;
      void taskId;
    },
    onGatewayCompleted: (taskId, result) => {
      completeGatewayTask(taskId, result);
    },
  });
}

/** 角色路由 → 网关任务完成：落库结果 + 广播 + 台账记账 */
export function completeGatewayTask(taskId: string, result: GatewayTaskResult): void {
  const status: TaskStatus = result.status;

  setTaskResult(taskId, {
    status,
    resultText: result.resultText,
    exitCode: status === 'completed' ? 0 : 1,
    durationMs: result.durationMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    error: result.error ?? (status === 'failed' ? '任务执行失败' : null),
  });

  appendMessage(
    taskId,
    nextSeq(taskId),
    'system',
    status,
    { message: status === 'completed' ? '任务完成' : `任务${status}` },
    Date.now(),
    randomId('msg'),
  );

  const task = getTask(taskId);
  void memoryLedger
    .recordTaskTerminal({
      taskId,
      deviceId: 'modelgateway',
      agentType: task?.target_agent_type ?? 'gateway',
      prompt: task?.prompt ?? '',
      status,
      resultText: result.resultText,
    })
    .catch((err) => console.error('[memory] 记账失败', err));

  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: randomId('patch'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: {
      kind: 'patch',
      tasks: [
        {
          taskId,
          status,
          resultText: result.resultText,
          durationMs: result.durationMs,
        },
      ],
      ts: Date.now(),
    },
  });

  broadcastToGateways({
    v: 1,
    type: MESSAGE_TYPES.TASK_RESULT,
    id: randomId('taskres'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'wechat',
    payload: {
      taskId,
      status: status === 'interrupted' ? 'interrupted' : status,
      result: {
        text: result.resultText,
        exitCode: status === 'completed' ? 0 : 1,
        durationMs: result.durationMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      },
      logs: [],
      finishedAt: Date.now(),
    },
  });
}

/** 设备上报 task.event：落库 + 广播 */
export function onDeviceTaskEvent(event: TaskEvent): void {
  if (!event?.taskId) return;
  // 协调服务为权威序号来源：保证同一 task 内 seq 严格递增
  const seq = nextSeq(event.taskId);
  const normEvent: TaskEvent = { ...event, seq };

  appendMessage(
    event.taskId,
    seq,
    normEvent.eventType,
    normEvent.status ?? null,
    normEvent.data as Record<string, unknown>,
    normEvent.ts || Date.now(),
    randomId('msg'),
  );

  // eventType=status 携带状态流转
  if (normEvent.eventType === 'status' && normEvent.status) {
    updateTaskStatus(event.taskId, normEvent.status);
    if (normEvent.status === 'completed' || normEvent.status === 'failed' || normEvent.status === 'cancelled') {
      finalize(event.taskId, normEvent.status);
    }
  }

  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: randomId('patch'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: taskEventPatch(normEvent),
  });
}

/** 设备上报 task.result：最终结果落库 + 释放 + 广播 */
export function onDeviceTaskResult(result: TaskResult): void {
  if (!result?.taskId) return;
  const status: TaskStatus = result.status === 'interrupted' ? 'interrupted' : result.status;

  setTaskResult(result.taskId, {
    status,
    resultText: result.result?.text ?? '',
    exitCode: result.result?.exitCode ?? 0,
    durationMs: result.result?.durationMs ?? Date.now() - (running.get(result.taskId)?.startedAt ?? Date.now()),
    tokensIn: result.result?.tokensIn,
    tokensOut: result.result?.tokensOut,
    error: status === 'failed' ? (result.result?.error ?? '任务执行失败') : null,
  });

  // 结果作为一条 system 事件落库（时间线可见）
  appendMessage(
    result.taskId,
    nextSeq(result.taskId),
    'system',
    status,
    { message: status === 'completed' ? '任务完成' : `任务${status}` },
    Date.now(),
    randomId('msg'),
  );

  finalize(result.taskId, status);

  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: randomId('patch'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: {
      kind: 'patch',
      tasks: [
        {
          taskId: result.taskId,
          status,
          resultText: result.result?.text ?? '',
          durationMs: result.result?.durationMs,
        },
      ],
      ts: Date.now(),
    },
  });

  // 结果回推网关（微信）
  broadcastToGateways({
    v: 1,
    type: MESSAGE_TYPES.TASK_RESULT,
    id: randomId('taskres'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'wechat',
    payload: result,
  });
}

/** 设备断线：其 running 任务标记 interrupted（P0-8） */
export function onDeviceDisconnected(deviceId: string): void {
  const tasks = listTasks({ deviceId }).filter((t) => t.status === 'running');
  for (const t of tasks) {
    updateTaskStatus(t.task_id, 'interrupted', { error: '设备断线' });
    appendMessage(
      t.task_id,
      nextSeq(t.task_id),
      'status',
      'interrupted',
      { message: '设备断线，任务中断' },
      Date.now(),
      randomId('msg'),
    );
    broadcastToDashboards({
      v: 1,
      type: MESSAGE_TYPES.DASHBOARD_PATCH,
      id: randomId('patch'),
      ts: Date.now(),
      from: 'coordinator',
      to: 'dashboard',
      payload: taskStatusPatch(t.task_id, 'interrupted'),
    });
    finalize(t.task_id, 'interrupted');
  }
  deviceRegistry.remove(deviceId);
}

/** 取消任务 */
export function cancelTask(taskId: string, reason: 'user_cancel' | 'system' = 'user_cancel'): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  if (task.status !== 'queued' && task.status !== 'running') return false;

  const rec = running.get(taskId);
  if (task.status === 'running' && rec) {
    sendToDevice(rec.deviceId, {
      v: 1,
      type: MESSAGE_TYPES.TASK_CANCEL,
      id: randomId('cancel'),
      ts: Date.now(),
      from: 'coordinator',
      to: rec.deviceId,
      payload: { taskId, reason: reason === 'user_cancel' ? 'user_cancel' : 'system' },
    });
  }
  updateTaskStatus(taskId, 'cancelled', { finished_at: Date.now() });
  appendMessage(
    taskId,
    nextSeq(taskId),
    'status',
    'cancelled',
    { message: '任务已取消' },
    Date.now(),
    randomId('msg'),
  );
  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: randomId('patch'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: taskStatusPatch(taskId, 'cancelled'),
  });
  finalize(taskId, 'cancelled');
  return true;
}

/** 重试任务：按原任务目标新建一条 queued 任务 */
export function retryTask(taskId: string): string | null {
  const task = getTask(taskId);
  if (!task) return null;
  const newTaskId = randomId('task');
  const input: SchedulerSubmitInput = {
    taskId: newTaskId,
    sessionId: task.session_id,
    origin: task.origin,
    originRef: task.origin_ref,
    prompt: task.prompt,
    targetMode: task.target_mode,
    targetDeviceId: task.target_device_id ?? undefined,
    targetAgentType: task.target_agent_type ?? undefined,
    targetRole: task.target_role ?? undefined,
    targetTeamId: task.target_team_id ?? undefined,
    requireCapability: task.require_capability ?? undefined,
  };
  enqueueTask(input);
  return newTaskId;
}

/** 内部：给任务发一条事件 */
function emitEvent(
  taskId: string,
  eventType: TaskEventType,
  status: TaskStatus | undefined,
  data: Record<string, unknown>,
): void {
  const seq = nextSeq(taskId);
  const event: TaskEvent = {
    taskId,
    seq,
    eventType,
    status,
    data,
    ts: Date.now(),
  };
  appendMessage(taskId, seq, eventType, status ?? null, data, event.ts, randomId('msg'));
  broadcastToDashboards({
    v: 1,
    type: MESSAGE_TYPES.DASHBOARD_PATCH,
    id: randomId('patch'),
    ts: Date.now(),
    from: 'coordinator',
    to: 'dashboard',
    payload: taskEventPatch(event),
  });
}

/** 超时定时器 */
function armTimeout(taskId: string): void {
  const rec = running.get(taskId);
  if (!rec || rec.timer) return;
  rec.timer = setTimeout(() => {
    const task = getTask(taskId);
    if (!task || task.status !== 'running') return;
    emitEvent(taskId, 'status', 'failed', { message: '任务超时' });
    updateTaskStatus(taskId, 'failed', { finished_at: Date.now(), error: '超时' });
    sendToDevice(rec.deviceId, {
      v: 1,
      type: MESSAGE_TYPES.TASK_CANCEL,
      id: randomId('cancel'),
      ts: Date.now(),
      from: 'coordinator',
      to: rec.deviceId,
      payload: { taskId, reason: 'timeout' },
    });
    finalize(taskId, 'failed');
  }, DEFAULT_TIMEOUT_MS);
  rec.timer.unref();
}

/** 终态收尾：清 timer、释放 agent、触发后续派发、写入团队记忆账本 */
function finalize(taskId: string, status: TaskStatus): void {
  const rec = running.get(taskId);
  if (!rec) return;
  // 任务终态 → 团队记忆账本记账（fire-and-forget，不阻塞任务流转）
  const task = getTask(taskId);
  void memoryLedger
    .recordTaskTerminal({
      taskId,
      deviceId: rec.deviceId,
      agentType: rec.agentType,
      prompt: task?.prompt ?? '',
      status,
      resultText: task?.result_text ?? undefined,
    })
    .catch((err) => console.error('[memory] 记账失败', err));
  if (rec.timer) {
    clearTimeout(rec.timer);
    rec.timer = null;
  }
  release(rec.deviceId, rec.agentType);
  running.delete(taskId);
}

/** 供快照/查询使用的运行中计数 */
export function runningCount(): number {
  return running.size;
}
