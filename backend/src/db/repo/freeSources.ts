import { getDb } from '../database.js';

/**
 * 免费模型源目录（free_sources）CRUD。
 * 抓取自 dsh-our-free-model registry.json：各平台协议兼容的免费/付费源。
 */

export interface FreeSourceRow {
  source_id: string;
  name: string;
  category: string;
  format: string;
  base_url: string;
  models: string;
  notes: string;
  website: string;
  updated_at: number;
}

export interface FreeSourceModel {
  id: string;
  name?: string;
}

export interface FreeSource {
  sourceId: string;
  name: string;
  category: string;
  format: string;
  baseUrl: string;
  models: FreeSourceModel[];
  notes: string;
  website: string;
  /** 抓取/更新时间（upsert 时填充，解析输入可缺省） */
  updatedAt?: number;
}

function rowToSource(row: FreeSourceRow): FreeSource {
  let models: FreeSourceModel[] = [];
  try {
    models = JSON.parse(row.models || '[]') as FreeSourceModel[];
  } catch {
    models = [];
  }
  return {
    sourceId: row.source_id,
    name: row.name,
    category: row.category,
    format: row.format,
    baseUrl: row.base_url,
    models,
    notes: row.notes,
    website: row.website,
    updatedAt: row.updated_at,
  };
}

/** 批量 upsert（抓取后全量覆盖式写入） */
export function upsertFreeSources(sources: FreeSource[]): number {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO free_sources (source_id, name, category, format, base_url, models, notes, website, updated_at)
     VALUES (@sourceId, @name, @category, @format, @baseUrl, @models, @notes, @website, @now)
     ON CONFLICT(source_id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       format = excluded.format,
       base_url = excluded.base_url,
       models = excluded.models,
       notes = excluded.notes,
       website = excluded.website,
       updated_at = excluded.updated_at`,
  );
  let n = 0;
  for (const s of sources) {
    n += stmt.run({
      sourceId: s.sourceId,
      name: s.name,
      category: s.category,
      format: s.format,
      baseUrl: s.baseUrl,
      models: JSON.stringify(s.models),
      notes: s.notes,
      website: s.website,
      now,
    }).changes;
  }
  return n;
}

/** 列表（可按 format / category 过滤） */
export function listFreeSources(filter: { format?: string; category?: string } = {}): FreeSource[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.format) {
    clauses.push('format = @format');
    params.format = filter.format;
  }
  if (filter.category) {
    clauses.push('category = @category');
    params.category = filter.category;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM free_sources ${where} ORDER BY name ASC`)
    .all(params) as FreeSourceRow[];
  return rows.map(rowToSource);
}

/** 目录总数 */
export function countFreeSources(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM free_sources`).get() as { n: number };
  return row.n;
}
