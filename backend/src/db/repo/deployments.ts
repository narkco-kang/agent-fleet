import { getDb } from '../database.js';
import type {
  AgentType,
  DeployOS,
  DeploymentBatch,
  DeploymentBatchStatus,
  DeploymentTarget,
  DeployTargetStatus,
} from '@agentmesh/shared';

/**
 * 部署批次（deployment_batches）+ 目标（deployment_targets）CRUD。
 * 安全红线：deployment_targets **无 password 列**，密码仅存内存。
 */

export interface DeploymentBatchRow {
  batch_id: string;
  name: string;
  status: DeploymentBatchStatus;
  created_at: number;
}

export interface DeploymentTargetRow {
  target_id: string;
  batch_id: string;
  ip: string;
  user: string;
  os: DeployOS;
  platforms: string;
  status: DeployTargetStatus;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

/** 目标行 → shared.DeploymentTarget */
export function rowToTarget(row: DeploymentTargetRow): DeploymentTarget {
  return {
    id: row.target_id,
    batchId: row.batch_id,
    ip: row.ip,
    user: row.user,
    os: row.os,
    platforms: JSON.parse(row.platforms || '[]') as AgentType[],
    status: row.status,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

/** 创建批次 */
export function createBatch(input: { batchId: string; name: string }): DeploymentBatch {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO deployment_batches (batch_id, name, status, created_at)
       VALUES (@batchId, @name, 'pending_confirmation', @now)`,
    )
    .run({ batchId: input.batchId, name: input.name, now });
  return getBatch(input.batchId) as DeploymentBatch;
}

/** 查询批次 */
export function getBatch(batchId: string): DeploymentBatch | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM deployment_batches WHERE batch_id = ?`)
    .get(batchId) as DeploymentBatchRow | undefined;
  if (!row) return undefined;
  return {
    id: row.batch_id,
    name: row.name,
    status: row.status,
    targets: listTargetsByBatch(row.batch_id),
    createdAt: row.created_at,
  };
}

/** 列表批次 */
export function listBatches(limit = 500): DeploymentBatch[] {
  const rows = getDb()
    .prepare(`SELECT * FROM deployment_batches ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as DeploymentBatchRow[];
  return rows.map((r) => ({
    id: r.batch_id,
    name: r.name,
    status: r.status,
    targets: listTargetsByBatch(r.batch_id),
    createdAt: r.created_at,
  }));
}

/** 更新批次状态 */
export function updateBatchStatus(batchId: string, status: DeploymentBatchStatus): void {
  getDb().prepare(`UPDATE deployment_batches SET status = ? WHERE batch_id = ?`).run(status, batchId);
}

/** 创建目标（无密码列） */
export function createTarget(input: {
  targetId: string;
  batchId: string;
  ip: string;
  user: string;
  platforms?: AgentType[];
}): DeploymentTarget {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO deployment_targets (target_id, batch_id, ip, user, os, platforms, status, created_at)
       VALUES (@targetId, @batchId, @ip, @user, 'unknown', @platforms, 'pending', @now)`,
    )
    .run({
      targetId: input.targetId,
      batchId: input.batchId,
      ip: input.ip,
      user: input.user,
      platforms: JSON.stringify(input.platforms ?? []),
      now,
    });
  return getTarget(input.targetId) as DeploymentTarget;
}

/** 查询目标 */
export function getTarget(targetId: string): DeploymentTarget | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM deployment_targets WHERE target_id = ?`)
    .get(targetId) as DeploymentTargetRow | undefined;
  return row ? rowToTarget(row) : undefined;
}

/** 批次目标列表 */
export function listTargetsByBatch(batchId: string): DeploymentTarget[] {
  const rows = getDb()
    .prepare(`SELECT * FROM deployment_targets WHERE batch_id = ? ORDER BY created_at ASC`)
    .all(batchId) as DeploymentTargetRow[];
  return rows.map(rowToTarget);
}

/** 更新目标状态（含 os / error / finished_at） */
export function updateTargetStatus(
  targetId: string,
  status: DeployTargetStatus,
  extra: { os?: DeployOS; error?: string | null; finishedAt?: number | null } = {},
): void {
  getDb()
    .prepare(
      `UPDATE deployment_targets SET
        status = @status,
        os = COALESCE(@os, os),
        error = @error,
        finished_at = CASE WHEN @finishedAt IS NOT NULL THEN @finishedAt
                           WHEN @status IN ('success','failed') THEN @now
                           ELSE finished_at END
       WHERE target_id = @targetId`,
    )
    .run({
      targetId,
      status,
      os: extra.os ?? null,
      error: extra.error ?? null,
      finishedAt: extra.finishedAt ?? null,
      now: Date.now(),
    });
}
