import { getDb } from '../database.js';
import type { Origin } from '@agentmesh/shared';

/** sessions 表行结构 */
export interface SessionRow {
  session_id: string;
  origin: Origin;
  origin_ref: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/** 创建会话（已存在则忽略） */
export function createSession(
  sessionId: string,
  origin: Origin,
  originRef: string,
  title: string,
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO sessions (session_id, origin, origin_ref, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO NOTHING`,
    )
    .run(sessionId, origin, originRef, title, now, now);
}

/** 更新会话标题 */
export function updateSessionTitle(sessionId: string, title: string): void {
  getDb()
    .prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?`)
    .run(title, Date.now(), sessionId);
}

/** 查询会话 */
export function getSession(sessionId: string): SessionRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
    .get(sessionId) as SessionRow | undefined;
}

/** 会话列表 */
export function listSessions(limit = 100): SessionRow[] {
  return getDb()
    .prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as SessionRow[];
}

/** 从首条 prompt 截断生成标题 */
export function makeTitle(prompt: string, maxLen = 40): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine || '未命名任务';
  return `${oneLine.slice(0, maxLen)}…`;
}
