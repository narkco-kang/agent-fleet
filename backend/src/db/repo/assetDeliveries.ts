import { getDb } from '../database.js';
import type { AssetDelivery, DeliveryStatus } from '@agentfleet/shared';
import { getAsset } from './assets.js';

/**
 * 资产分发记录表（asset_deliveries）CRUD。
 */

/** 陈旧工作区项（设备已分发资产版本落后于最新基线）。 */
export interface StaleDelivery {
  assetId: string;
  assetName: string;
  /** 资产当前最新版本（基线）。 */
  assetVersion: number;
  deviceId: string;
  /** 设备已收到的版本（落后于基线即陈旧）。 */
  deliveredVersion: number;
}

export interface AssetDeliveryRow {
  delivery_id: string;
  asset_id: string;
  asset_version: number;
  device_id: string;
  status: DeliveryStatus;
  error: string | null;
  created_at: number;
  delivered_at: number | null;
}

/** 行 → shared.AssetDelivery */
export function rowToDelivery(row: AssetDeliveryRow): AssetDelivery {
  return {
    id: row.delivery_id,
    assetId: row.asset_id,
    assetVersion: row.asset_version,
    deviceId: row.device_id,
    status: row.status,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
  };
}

/** 创建分发记录 */
export function createDelivery(input: {
  deliveryId: string;
  assetId: string;
  assetVersion: number;
  deviceId: string;
  status?: DeliveryStatus;
}): AssetDelivery {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO asset_deliveries (delivery_id, asset_id, asset_version, device_id, status, created_at)
       VALUES (@deliveryId, @assetId, @assetVersion, @deviceId, @status, @now)`,
    )
    .run({
      deliveryId: input.deliveryId,
      assetId: input.assetId,
      assetVersion: input.assetVersion,
      deviceId: input.deviceId,
      status: input.status ?? 'pending',
      now,
    });
  return getDelivery(input.deliveryId) as AssetDelivery;
}

/** 查询单个分发记录 */
export function getDelivery(deliveryId: string): AssetDelivery | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM asset_deliveries WHERE delivery_id = ?`)
    .get(deliveryId) as AssetDeliveryRow | undefined;
  return row ? rowToDelivery(row) : undefined;
}

/** 更新分发状态 */
export function updateDeliveryStatus(
  deliveryId: string,
  status: DeliveryStatus,
  extra: { error?: string | null } = {},
): void {
  getDb()
    .prepare(
      `UPDATE asset_deliveries SET
        status = @status,
        error = @error,
        delivered_at = CASE WHEN @status IN ('delivered','failed') THEN @now ELSE delivered_at END
       WHERE delivery_id = @deliveryId`,
    )
    .run({ deliveryId, status, error: extra.error ?? null, now: Date.now() });
}

/** 列表（可按状态/设备过滤） */
export function listDeliveries(
  filter: { status?: DeliveryStatus; deviceId?: string } = {},
  limit = 500,
): AssetDelivery[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.status) {
    clauses.push('status = @status');
    params.status = filter.status;
  }
  if (filter.deviceId) {
    clauses.push('device_id = @deviceId');
    params.deviceId = filter.deviceId;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM asset_deliveries ${where} ORDER BY created_at DESC LIMIT @limit`)
    .all({ ...params, limit }) as AssetDeliveryRow[];
  return rows.map(rowToDelivery);
}

/** 待补发记录（离线排队，设备上线后补发） */
export function listPendingDeliveries(limit = 500): AssetDelivery[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM asset_deliveries WHERE status IN ('pending','sending') ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as AssetDeliveryRow[];
  return rows.map(rowToDelivery);
}

/**
 * 陈旧工作区检测（stale-base，能力地图 3.3）：找出「设备已分发资产版本 < 资产最新基线」的项，
 * 提示用户重新分发。资产每次更新 version 递增，设备未重新分发即落后 → 陈旧。
 */
export function staleDeliveries(): StaleDelivery[] {
  const rows = getDb()
    .prepare(
      `SELECT device_id, asset_id, MAX(asset_version) AS delivered_version
       FROM asset_deliveries
       WHERE status = 'delivered'
       GROUP BY device_id, asset_id`,
    )
    .all() as Array<{ device_id: string; asset_id: string; delivered_version: number }>;

  const out: StaleDelivery[] = [];
  for (const r of rows) {
    const asset = getAsset(r.asset_id);
    if (!asset) continue; // 资产已删除
    if (r.delivered_version < asset.version) {
      out.push({
        assetId: r.asset_id,
        assetName: asset.name,
        assetVersion: asset.version,
        deviceId: r.device_id,
        deliveredVersion: r.delivered_version,
      });
    }
  }
  return out.sort((a, b) => a.assetName.localeCompare(b.assetName) || a.deviceId.localeCompare(b.deviceId));
}
