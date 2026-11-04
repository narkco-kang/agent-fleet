import { getDb } from '../database.js';

/**
 * 台账表（usage_records）——token 消耗台账。
 */

export interface UsageRecordRow {
  record_id: string;
  task_id: string | null;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  created_at: number;
}

/** 插入一条台账记录 */
export function insertUsage(input: {
  recordId: string;
  taskId?: string | null;
  provider?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cost?: number | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO usage_records (record_id, task_id, provider, model, tokens_in, tokens_out, cost, created_at)
       VALUES (@recordId, @taskId, @provider, @model, @tokensIn, @tokensOut, @cost, @now)`,
    )
    .run({
      recordId: input.recordId,
      taskId: input.taskId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      cost: input.cost ?? null,
      now: Date.now(),
    });
}

/** 列表台账 */
export function listUsage(limit = 500): UsageRecordRow[] {
  return getDb()
    .prepare(`SELECT * FROM usage_records ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as UsageRecordRow[];
}

/** 台账摘要（按 provider / model 聚合 + 总量 + 成本） */
export function usageSummary(): {
  totalRecords: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  byProvider: Record<string, { tokensIn: number; tokensOut: number; cost: number; records: number }>;
  byModel: Record<string, { tokensIn: number; tokensOut: number; cost: number; records: number }>;
} {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(tokens_in),0) AS tin,
              COALESCE(SUM(tokens_out),0) AS tout,
              COALESCE(SUM(cost),0) AS cost
       FROM usage_records`,
    )
    .get() as { n: number; tin: number; tout: number; cost: number };

  const byProvider: Record<string, { tokensIn: number; tokensOut: number; cost: number; records: number }> = {};
  const pRows = db
    .prepare(
      `SELECT provider, COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, COALESCE(SUM(cost),0) AS cost
       FROM usage_records GROUP BY provider`,
    )
    .all() as Array<{ provider: string | null; n: number; tin: number; tout: number; cost: number }>;
  for (const r of pRows) {
    byProvider[r.provider ?? 'unknown'] = { tokensIn: r.tin, tokensOut: r.tout, cost: r.cost, records: r.n };
  }

  const byModel: Record<string, { tokensIn: number; tokensOut: number; cost: number; records: number }> = {};
  const mRows = db
    .prepare(
      `SELECT model, COUNT(*) AS n, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout, COALESCE(SUM(cost),0) AS cost
       FROM usage_records GROUP BY model`,
    )
    .all() as Array<{ model: string | null; n: number; tin: number; tout: number; cost: number }>;
  for (const r of mRows) {
    byModel[r.model ?? 'unknown'] = { tokensIn: r.tin, tokensOut: r.tout, cost: r.cost, records: r.n };
  }

  return {
    totalRecords: totals.n,
    totalTokensIn: totals.tin,
    totalTokensOut: totals.tout,
    totalCost: totals.cost,
    byProvider,
    byModel,
  };
}
