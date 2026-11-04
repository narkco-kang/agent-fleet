import { getDb } from '../database.js';

/**
 * 任务级上下文交接摘要（P0-3）。
 *
 * 任务终态时生成「有界摘要」（prompt + 结果截断，规则抽取，不调 LLM 保持零依赖），
 * 同 session 下一任务提交时注入前序摘要到 prompt 前缀，实现任务链上下文累积。
 */

export interface TaskContextRow {
  task_id: string;
  session_id: string;
  summary: string;
  token_count: number;
  updated_at: number;
}

/** 写入/覆盖一条任务交接摘要 */
export function saveTaskContext(
  taskId: string,
  sessionId: string,
  summary: string,
  tokenCount: number,
): void {
  getDb()
    .prepare(
      `INSERT INTO task_contexts (task_id, session_id, summary, token_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         summary = excluded.summary,
         token_count = excluded.token_count,
         updated_at = excluded.updated_at`,
    )
    .run(taskId, sessionId, summary, tokenCount, Date.now());
}

/** 查同 session 最近一条摘要（供下一任务注入；无则 null） */
export function getLatestSummary(sessionId: string): { summary: string; taskId: string } | null {
  const row = getDb()
    .prepare(
      `SELECT task_id, summary FROM task_contexts
       WHERE session_id = ? AND summary != ''
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(sessionId) as { task_id: string; summary: string } | undefined;
  if (!row) return null;
  return { summary: row.summary, taskId: row.task_id };
}
