import { getDb } from '../database.js';
import type {
  AgentType,
  Origin,
  TargetMode,
  TaskSnapshot,
  TaskStatus,
} from '@agentfleet/shared';

/** tasks 表行结构 */
export interface TaskRow {
  task_id: string;
  session_id: string;
  origin: Origin;
  origin_ref: string;
  prompt: string;
  target_mode: TargetMode;
  target_device_id: string | null;
  target_agent_type: AgentType | null;
  target_role: string | null;
  target_team_id: string | null;
  require_capability: string | null;
  agent_profile: string | null;
  status: TaskStatus;
  result_text: string | null;
  exit_code: number | null;
  error: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

/** 任务创建输入 */
export interface TaskCreateInput {
  taskId: string;
  sessionId: string;
  origin: Origin;
  originRef: string;
  prompt: string;
  targetMode: TargetMode;
  targetDeviceId?: string | null;
  targetAgentType?: AgentType | null;
  targetRole?: string | null;
  targetTeamId?: string | null;
  requireCapability?: string | null;
  agentProfile?: string | null;
}

/** 创建任务（status=queued） */
export function createTask(input: TaskCreateInput): void {
  getDb()
    .prepare(
      `INSERT INTO tasks
        (task_id, session_id, origin, origin_ref, prompt, target_mode,
         target_device_id, target_agent_type, target_role, target_team_id,
         require_capability, agent_profile, status, created_at)
       VALUES (@taskId, @sessionId, @origin, @originRef, @prompt, @targetMode,
         @targetDeviceId, @targetAgentType, @targetRole, @targetTeamId,
         @requireCapability, @agentProfile, 'queued', @now)`,
    )
    .run({
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
      agentProfile: input.agentProfile ?? null,
      now: Date.now(),
    });
}

/** 查询任务 */
export function getTask(taskId: string): TaskRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM tasks WHERE task_id = ?`)
    .get(taskId) as TaskRow | undefined;
}

/** 更新任务状态（可选附加字段） */
export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  extra: Partial<Pick<TaskRow, 'started_at' | 'finished_at' | 'error'>> = {},
): void {
  const sets: string[] = ['status = @status'];
  const params: Record<string, unknown> = { taskId, status };
  if (extra.started_at !== undefined) {
    sets.push('started_at = @startedAt');
    params.startedAt = extra.started_at;
  }
  if (extra.finished_at !== undefined) {
    sets.push('finished_at = @finishedAt');
    params.finishedAt = extra.finished_at;
  }
  if (extra.error !== undefined) {
    sets.push('error = @error');
    params.error = extra.error;
  }
  getDb()
    .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE task_id = @taskId`)
    .run(params);
}

/** 写入任务结果 */
export function setTaskResult(
  taskId: string,
  data: {
    status: TaskStatus;
    resultText: string;
    exitCode: number;
    durationMs: number;
    tokensIn?: number;
    tokensOut?: number;
    error?: string | null;
  },
): void {
  getDb()
    .prepare(
      `UPDATE tasks SET
        status = @status,
        result_text = @resultText,
        exit_code = @exitCode,
        duration_ms = @durationMs,
        tokens_in = @tokensIn,
        tokens_out = @tokensOut,
        error = @error,
        finished_at = @now
       WHERE task_id = @taskId`,
    )
    .run({
      taskId,
      status: data.status,
      resultText: data.resultText,
      exitCode: data.exitCode,
      durationMs: data.durationMs,
      tokensIn: data.tokensIn ?? null,
      tokensOut: data.tokensOut ?? null,
      error: data.error ?? null,
      now: Date.now(),
    });
}

/** 分配目标（调度确定后写回） */
export function assignTaskTarget(
  taskId: string,
  deviceId: string,
  agentType: AgentType,
): void {
  getDb()
    .prepare(
      `UPDATE tasks SET target_device_id = ?, target_agent_type = ? WHERE task_id = ?`,
    )
    .run(deviceId, agentType, taskId);
}

/** 列表查询（支持状态/设备/agent 筛选 + 分页） */
export function listTasks(
  filters: { status?: TaskStatus; deviceId?: string; agentType?: AgentType } = {},
  limit = 200,
): TaskRow[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.status) {
    clauses.push('status = @status');
    params.status = filters.status;
  }
  if (filters.deviceId) {
    clauses.push('target_device_id = @deviceId');
    params.deviceId = filters.deviceId;
  }
  if (filters.agentType) {
    clauses.push('target_agent_type = @agentType');
    params.agentType = filters.agentType;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT @limit`)
    .all({ ...params, limit }) as TaskRow[];
}

/** 统计各状态数量 */
export function countTasksByStatus(): Record<TaskStatus, number> {
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`)
    .all() as Array<{ status: TaskStatus; n: number }>;
  const out: Record<TaskStatus, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    interrupted: 0,
  };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** 构造看板快照任务节点 */
export function toTaskSnapshot(row: TaskRow): TaskSnapshot {
  return {
    taskId: row.task_id,
    sessionId: row.session_id,
    origin: row.origin,
    prompt: row.prompt,
    status: row.status,
    targetMode: row.target_mode,
    targetDeviceId: row.target_device_id,
    targetAgentType: row.target_agent_type,
    targetRole: row.target_role,
    targetTeamId: row.target_team_id,
    agentProfile: row.agent_profile,
    resultText: row.result_text,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
