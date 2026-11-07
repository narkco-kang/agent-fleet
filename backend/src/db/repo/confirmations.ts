import { getDb } from '../database.js';
import type { ActionConfirmation, ActionKind, ActionStatus } from '@agentfleet/shared';

/**
 * 人工确认记录表（action_confirmations）CRUD。
 *
 * DSH 融合：确认记录同时是 Mandate —— 锁住受理时的 policy_version；
 * 策略变更只写 policy_notice（不撤销授权），与 dsh-superagent 的
 * `Engine.policyChanged` 语义一致。
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
  policy_version: string | null;
  policy_notice: string | null;
  reason: string | null;
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
    policyVersion: row.policy_version ?? undefined,
    policyNotice: row.policy_notice || undefined,
    reason: row.reason || undefined,
  };
}

/** 创建确认记录（policyVersion = 受理时的策略指纹） */
export function createConfirmation(input: {
  confirmationId: string;
  kind: ActionKind;
  refId: string;
  payloadSummary: string;
  policyVersion?: string;
}): ActionConfirmation {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO action_confirmations
        (confirmation_id, kind, ref_id, status, payload_summary, created_at, policy_version, policy_notice, reason)
       VALUES (@confirmationId, @kind, @refId, 'pending_confirmation', @payloadSummary, @now, @policyVersion, '', '')`,
    )
    .run({
      confirmationId: input.confirmationId,
      kind: input.kind,
      refId: input.refId,
      payloadSummary: input.payloadSummary,
      now,
      policyVersion: input.policyVersion ?? '',
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

/**
 * 更新确认状态。
 * `reason` 存结构化 Reason JSON：拒绝/复检失败时不再静默丢掉原因（DSH 诚实报告）。
 */
export function updateConfirmationStatus(
  confirmationId: string,
  status: ActionStatus,
  by?: string,
  reason?: string,
): void {
  getDb()
    .prepare(
      `UPDATE action_confirmations SET
        status = @status,
        confirmed_at = CASE WHEN @status IN ('confirmed','executed') THEN @now ELSE confirmed_at END,
        confirmed_by = CASE WHEN @status IN ('confirmed','executed') THEN @by ELSE confirmed_by END,
        reason = COALESCE(@reason, reason)
       WHERE confirmation_id = @confirmationId`,
    )
    .run({ confirmationId, status, by: by ?? null, now: Date.now(), reason: reason ?? null });
}

/**
 * 策略变更送达在途单：只给「尚未确认」的单写 notice，不改动其 status，
 * 也不撤销已锁定的 policy_version（Mandate 仍然有效）。
 */
export function markPolicyNotices(noticeJson: string): number {
  return getDb()
    .prepare(
      `UPDATE action_confirmations SET policy_notice = ?
       WHERE status = 'pending_confirmation' AND (policy_notice IS NULL OR policy_notice = '')`,
    )
    .run(noticeJson).changes;
}

/** 列出带策略变更通知的在途单（供看板提示） */
export function listPolicyNotices(limit = 100): ActionConfirmation[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM action_confirmations
       WHERE policy_notice IS NOT NULL AND policy_notice != ''
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as ActionConfirmationRow[];
  return rows.map(rowToConfirmation);
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
