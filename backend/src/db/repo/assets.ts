import { getDb } from '../database.js';
import type { Asset, AssetContentType, AssetKind } from '@agentfleet/shared';

/**
 * 资产表（assets）CRUD + 版本递增。
 */

export interface AssetRow {
  asset_id: string;
  kind: AssetKind;
  name: string;
  content: string;
  content_type: AssetContentType;
  version: number;
  tags: string;
  created_at: number;
  updated_at: number;
}

/** 行 → shared.Asset */
export function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.asset_id,
    kind: row.kind,
    name: row.name,
    content: row.content,
    contentType: row.content_type,
    version: row.version,
    tags: JSON.parse(row.tags || '[]') as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 资产创建输入 */
export interface AssetCreateInput {
  assetId: string;
  kind: AssetKind;
  name: string;
  content: string;
  contentType?: AssetContentType;
  tags?: string[];
}

/** 创建资产（version=1） */
export function createAsset(input: AssetCreateInput): Asset {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO assets (asset_id, kind, name, content, content_type, version, tags, created_at, updated_at)
       VALUES (@assetId, @kind, @name, @content, @contentType, 1, @tags, @now, @now)`,
    )
    .run({
      assetId: input.assetId,
      kind: input.kind,
      name: input.name,
      content: input.content,
      contentType: input.contentType ?? 'text',
      tags: JSON.stringify(input.tags ?? []),
      now,
    });
  return getAsset(input.assetId) as Asset;
}

/** 查询单个资产 */
export function getAsset(assetId: string): Asset | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM assets WHERE asset_id = ?`)
    .get(assetId) as AssetRow | undefined;
  return row ? rowToAsset(row) : undefined;
}

/** 更新资产内容（version 递增 +1） */
export function updateAsset(
  assetId: string,
  patch: { name?: string; content?: string; contentType?: AssetContentType; tags?: string[] },
): Asset | undefined {
  const prev = getAsset(assetId);
  if (!prev) return undefined;

  const now = Date.now();
  getDb()
    .prepare(
      `UPDATE assets SET
        name = @name,
        content = @content,
        content_type = @contentType,
        version = @version,
        tags = @tags,
        updated_at = @now
       WHERE asset_id = @assetId`,
    )
    .run({
      assetId,
      name: patch.name ?? prev.name,
      content: patch.content ?? prev.content,
      contentType: patch.contentType ?? prev.contentType,
      version: prev.version + 1,
      tags: JSON.stringify(patch.tags ?? prev.tags),
      now,
    });
  return getAsset(assetId);
}

/** 列表（可按 kind 过滤） */
export function listAssets(filter: { kind?: AssetKind } = {}, limit = 500): Asset[] {
  const rows = (
    filter.kind
      ? getDb().prepare(`SELECT * FROM assets WHERE kind = ? ORDER BY updated_at DESC LIMIT ?`).all(filter.kind, limit)
      : getDb().prepare(`SELECT * FROM assets ORDER BY updated_at DESC LIMIT ?`).all(limit)
  ) as AssetRow[];
  return rows.map(rowToAsset);
}

/** 删除资产 */
export function deleteAsset(assetId: string): void {
  getDb().prepare(`DELETE FROM assets WHERE asset_id = ?`).run(assetId);
}
