import fs from 'node:fs';
import path from 'node:path';
import type { AssetDeliver, AssetDeliverAck, AssetKind } from '@agentmesh/shared';
import { config } from './config.js';

/**
 * 资产接收 + 落盘（设备侧）。
 * 接收 asset.deliver，按 kind 落盘到
 *   ~/.agentmesh/{rules|knowledge|skills}/<name>@v<version>
 * 成功后回 asset.deliver_ack{status:'delivered'}。
 */

const KIND_DIRS: Record<AssetKind, string> = {
  rule: 'rules',
  knowledge: 'knowledge',
  skill: 'skills',
};

/** 资产落盘目录 */
export function assetDir(kind: AssetKind): string {
  return path.join(config.dataDir, KIND_DIRS[kind] ?? 'assets');
}

/** 资产文件名（<name>@v<version>） */
export function assetFileName(name: string, version: number): string {
  return `${name}@v${version}`;
}

/** 落盘资产，返回绝对路径 */
export function saveAsset(asset: AssetDeliver): string {
  const dir = assetDir(asset.kind);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, assetFileName(asset.name, asset.version));
  fs.writeFileSync(filePath, asset.content, 'utf-8');
  return filePath;
}

/** 处理 asset.deliver → 落盘并回 ack */
export function handleAssetDeliver(asset: AssetDeliver, deviceId: string): AssetDeliverAck {
  const base = {
    deliveryId: asset.deliveryId,
    assetId: asset.assetId,
    deviceId,
    version: asset.version,
  };
  try {
    const savedPath = saveAsset(asset);
    return { ...base, status: 'delivered', path: savedPath };
  } catch (err) {
    return { ...base, status: 'failed', error: (err as Error).message };
  }
}
