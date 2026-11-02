import type { Asset, AssetContentType, AssetKind, AssetSource } from '@agentfleet/shared';
import { ASSET_KINDS } from '@agentfleet/shared';
import { randomId } from '../../security/auth.js';
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
} from '../../db/repo/assets.js';

/**
 * 资产服务：Asset CRUD + 版本递增（规则 / 资料库 / skills 统一模型）。
 */

export interface AssetCreateInput {
  kind: AssetKind;
  name: string;
  description?: string;
  source?: AssetSource;
  content: string;
  contentType?: AssetContentType;
  tags?: string[];
}

export interface AssetUpdateInput {
  name?: string;
  description?: string;
  source?: AssetSource;
  content?: string;
  contentType?: AssetContentType;
  tags?: string[];
}

function isAssetKind(kind: unknown): kind is AssetKind {
  return typeof kind === 'string' && (ASSET_KINDS as readonly string[]).includes(kind);
}

/** 校验来源字段（可选，缺省 manual） */
function normalizeSource(source: unknown): AssetSource {
  return source === 'github' || source === 'imported' ? source : 'manual';
}

/** 创建资产（version=1） */
export function create(input: AssetCreateInput): Asset {
  if (!isAssetKind(input.kind)) {
    throw new Error(`invalid asset kind: ${String(input.kind)}`);
  }
  if (!input.name || typeof input.name !== 'string') {
    throw new Error('asset name required');
  }
  return createAsset({
    assetId: randomId('asset'),
    kind: input.kind,
    name: input.name,
    description: input.description ?? '',
    source: normalizeSource(input.source),
    content: input.content ?? '',
    contentType: input.contentType ?? 'text',
    tags: input.tags ?? [],
  });
}

/** 更新资产（version 递增） */
export function update(assetId: string, patch: AssetUpdateInput): Asset | undefined {
  return updateAsset(assetId, {
    name: patch.name,
    description: patch.description,
    source: patch.source === undefined ? undefined : normalizeSource(patch.source),
    content: patch.content,
    contentType: patch.contentType,
    tags: patch.tags,
  });
}

/** 查询资产 */
export function get(assetId: string): Asset | undefined {
  return getAsset(assetId);
}

/** 列表 */
export function list(filter?: { kind?: AssetKind }): Asset[] {
  return listAssets(filter);
}

/** 删除 */
export function remove(assetId: string): void {
  deleteAsset(assetId);
}
