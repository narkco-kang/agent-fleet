import { getDb } from '../database.js';
import type { ActionConfirmation, ActionKind, ActionStatus } from '@agentfleet/shared';

/**
 * 人工确认记录表（action_confirmations）CRUD。
 */

export interface ActionConfirmationRow {
  confirmation_id: string;
  kind: ActionKind;
  ref_id: string;
  status: ActionStatus;
  payload_summary: string;
  created_at: number;
  confirmed_at: number | null;
  confirmed_by: string | null;
}

/** 行 → shared.ActionConfirmation */
export function rowToConfirmation(row: ActionConfirmationRow): ActionConfirmation {
  return {
    id: row.confirmation_id,
    kind: row.kind,
    refId: row.ref_id,
    status: row.status,
    payloadSummary: row.payload_summary,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
    confirmedBy: row.confirmed_by ?? undefined,
  };
}

/** 创建确认记录 */
export function createConfirmation(input: {
  confirmationId: string;
  kind: ActionKind;
  refId: string;
  payloadSummary: string;
}): ActionConfirmation {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO action_confirmations (confirmation_id, kind, ref_id, status, payload_summary, created_at)
       VALUES (@confirmationId, @kind, @refId, 'pending_confirmation', @payloadSummary, @now)`,
    )
    .run({
      confirmationId: input.confirmationId,
      kind: input.kind,
      refId: input.refId,
      payloadSummary: input.payloadSummary,
      now,
    });
  return getConfirmation(input.confirmationId) as ActionConfirmation;
}

/** 查询确认记录 */
export function getConfirmation(confirmationId: string): ActionConfirmation | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM action_confirmations WHERE confirmation_id = ?`)
    .get(confirmationId) as ActionConfirmationRow | undefined;
  return row ? rowToConfirmation(row) : undefined;
}

/** 按 kind + refId 查询最新一条 */
export function getByKindRef(kind: ActionKind, refId: string): ActionConfirmation | undefined {
  const row = getDb()
    .prepare(
      `SELECT * FROM action_confirmations WHERE kind = ? AND ref_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(kind, refId) as ActionConfirmationRow | undefined;
  return row ? rowToConfirmation(row) : undefined;
}

/** 更新确认状态 */
export function updateConfirmationStatus(
  confirmationId: string,
  status: ActionStatus,
  by?: string,
): void {
  getDb()
    .prepare(
      `UPDATE action_confirmations SET
        status = @status,
        confirmed_at = CASE WHEN @status IN ('confirmed','executed') THEN @now ELSE confirmed_at END,
        confirmed_by = CASE WHEN @status IN ('confirmed','executed') THEN @by ELSE confirmed_by END
       WHERE confirmation_id = @confirmationId`,
    )
    .run({ confirmationId, status, by: by ?? null, now: Date.now() });
}

/** 列表 */
export function listConfirmations(filter: { kind?: ActionKind; refId?: string } = {}, limit = 500): ActionConfirmation[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.kind) {
    clauses.push('kind = @kind');
    params.kind = filter.kind;
  }
  if (filter.refId) {
    clauses.push('ref_id = @refId');
    params.refId = filter.refId;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM action_confirmations ${where} ORDER BY created_at DESC LIMIT @limit`)
    .all({ ...params, limit }) as ActionConfirmationRow[];
  return rows.map(rowToConfirmation);
}
