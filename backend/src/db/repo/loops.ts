import { getDb } from '../database.js';
import type { Loop, LoopState, LoopStep, LoopTrigger } from '@agentmesh/shared';

/**
 * Loop 表（loops）CRUD（steps/targets 存 JSON）。
 */

export interface LoopRow {
  loop_id: string;
  name: string;
  steps: string;
  trigger: LoopTrigger;
  targets: string;
  state: LoopState;
  current_round: number;
  current_step_index: number;
  created_at: number;
  updated_at: number;
}

/** 行 → shared.Loop */
export function rowToLoop(row: LoopRow): Loop {
  return {
    id: row.loop_id,
    name: row.name,
    steps: JSON.parse(row.steps || '[]') as LoopStep[],
    trigger: row.trigger,
    targets: JSON.parse(row.targets || '[]') as string[],
    state: row.state,
    currentRound: row.current_round,
    currentStepIndex: row.current_step_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 创建 Loop */
export function createLoop(input: {
  loopId: string;
  name: string;
  steps?: LoopStep[];
  trigger?: LoopTrigger;
  targets?: string[];
}): Loop {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO loops (loop_id, name, steps, trigger, targets, state, current_round, current_step_index, created_at, updated_at)
       VALUES (@loopId, @name, @steps, @trigger, @targets, 'idle', 0, 0, @now, @now)`,
    )
    .run({
      loopId: input.loopId,
      name: input.name,
      steps: JSON.stringify(input.steps ?? []),
      trigger: input.trigger ?? 'manual',
      targets: JSON.stringify(input.targets ?? []),
      now,
    });
  return getLoop(input.loopId) as Loop;
}

/** 查询 Loop */
export function getLoop(loopId: string): Loop | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM loops WHERE loop_id = ?`)
    .get(loopId) as LoopRow | undefined;
  return row ? rowToLoop(row) : undefined;
}

/** 列表 */
export function listLoops(limit = 500): Loop[] {
  const rows = getDb()
    .prepare(`SELECT * FROM loops ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as LoopRow[];
  return rows.map(rowToLoop);
}

/** 更新 Loop 基本信息 */
export function updateLoop(
  loopId: string,
  patch: { name?: string; steps?: LoopStep[]; trigger?: LoopTrigger; targets?: string[] },
): Loop | undefined {
  const prev = getLoop(loopId);
  if (!prev) return undefined;
  getDb()
    .prepare(
      `UPDATE loops SET name = @name, steps = @steps, trigger = @trigger, targets = @targets, updated_at = @now
       WHERE loop_id = @loopId`,
    )
    .run({
      loopId,
      name: patch.name ?? prev.name,
      steps: JSON.stringify(patch.steps ?? prev.steps),
      trigger: patch.trigger ?? prev.trigger,
      targets: JSON.stringify(patch.targets ?? prev.targets),
      now: Date.now(),
    });
  return getLoop(loopId);
}

/** 更新 Loop 状态 */
export function updateLoopState(loopId: string, state: LoopState): void {
  getDb()
    .prepare(`UPDATE loops SET state = @state, updated_at = @now WHERE loop_id = @loopId`)
    .run({ loopId, state, now: Date.now() });
}

/** 更新 Loop 进度（round + step index） */
export function updateLoopProgress(loopId: string, round: number, stepIndex: number): void {
  getDb()
    .prepare(
      `UPDATE loops SET current_round = @round, current_step_index = @stepIndex, updated_at = @now
       WHERE loop_id = @loopId`,
    )
    .run({ loopId, round, stepIndex, now: Date.now() });
}

/** 删除 Loop */
export function deleteLoop(loopId: string): void {
  getDb().prepare(`DELETE FROM loops WHERE loop_id = ?`).run(loopId);
}
