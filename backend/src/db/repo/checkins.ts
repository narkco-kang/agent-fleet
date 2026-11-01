import { getDb } from '../database.js';

/**
 * 免费源自动签到审计表（free_checkins）CRUD。
 */

export interface CheckinRow {
  checkin_id: string;
  source_id: string;
  status: 'ok' | 'failed';
  detail: string;
  checked_at: number;
}

export function recordCheckin(input: {
  checkinId: string;
  sourceId: string;
  status: 'ok' | 'failed';
  detail: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO free_checkins (checkin_id, source_id, status, detail, checked_at)
       VALUES (@checkinId, @sourceId, @status, @detail, @now)`,
    )
    .run({
      checkinId: input.checkinId,
      sourceId: input.sourceId,
      status: input.status,
      detail: input.detail,
      now: Date.now(),
    });
}

export function listCheckins(sourceId?: string, limit = 100): CheckinRow[] {
  if (sourceId) {
    return getDb()
      .prepare(`SELECT * FROM free_checkins WHERE source_id = ? ORDER BY checked_at DESC LIMIT ?`)
      .all(sourceId, limit) as CheckinRow[];
  }
  return getDb()
    .prepare(`SELECT * FROM free_checkins ORDER BY checked_at DESC LIMIT ?`)
    .all(limit) as CheckinRow[];
}

/** 某源最近一次签到（无记录返回 undefined） */
export function lastCheckin(sourceId: string): CheckinRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM free_checkins WHERE source_id = ? ORDER BY checked_at DESC LIMIT 1`)
    .get(sourceId) as CheckinRow | undefined;
}
