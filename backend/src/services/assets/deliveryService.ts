import type { AssetDeliver, AssetDeliverAck, AssetDelivery } from '@agentmesh/shared';
import { MESSAGE_TYPES } from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import { getAsset } from '../../db/repo/assets.js';
import {
  createDelivery,
  listDeliveries,
  listPendingDeliveries,
  updateDeliveryStatus,
} from '../../db/repo/assetDeliveries.js';
import { actionGuard } from '../actionGuard.js';
import { deviceRegistry } from '../deviceRegistry.js';
import { sendToDevice } from '../../transport/wsServer.js';

/**
 * 资产分发编排：确认 → 下发 asset.deliver → 回收 asset.deliver_ack。
 *
 * - 离线排队（Q6）：目标设备离线时 delivery 保持 pending，上线后补发。
 * - 人工确认（安全红线）：未 confirm 前不产生任何 asset.deliver 消息。
 */

/** 待确认分发请求（内存暂存，确认后转为 asset_deliveries 行） */
interface PendingDeliveryRequest {
  assetIds: string[];
  targets: string[];
}

const pendingRequests = new Map<string, PendingDeliveryRequest>();

export interface DeliveryRequestResult {
  deliveryId: string;
  status: 'pending_confirmation';
  confirmationId: string;
  assetCount: number;
  targetCount: number;
  summary: string;
}

/** 请求分发：生成人工确认记录（未确认前不下发任何消息） */
export function requestDelivery(assetIds: string[], targets: string[]): DeliveryRequestResult {
  const deliveryId = randomId('delivery');
  pendingRequests.set(deliveryId, { assetIds: [...assetIds], targets: [...targets] });

  const summary = `资产分发：${assetIds.length} 个资产 → ${targets.length} 台设备`;
  const confirmation = actionGuard.request('asset_deliver', deliveryId, summary);

  return {
    deliveryId,
    status: 'pending_confirmation',
    confirmationId: confirmation.id,
    assetCount: assetIds.length,
    targetCount: targets.length,
    summary,
  };
}

/** 发送单条 asset.deliver 给在线设备 */
function sendToTarget(assetId: string, deviceId: string): AssetDelivery {
  const asset = getAsset(assetId);
  const delivery = createDelivery({
    deliveryId: randomId('delivery'),
    assetId,
    assetVersion: asset?.version ?? 1,
    deviceId,
    status: 'pending',
  });

  if (!asset) {
    updateDeliveryStatus(delivery.id, 'failed', { error: 'asset_not_found' });
    return { ...delivery, status: 'failed', error: 'asset_not_found' };
  }

  if (!deviceRegistry.isOnline(deviceId)) {
    // 离线排队（Q6）：保持 pending，上线后补发
    return delivery;
  }

  const payload: AssetDeliver = {
    deliveryId: delivery.id,
    assetId: asset.id,
    kind: asset.kind,
    name: asset.name,
    content: asset.content,
    contentType: asset.contentType,
    version: asset.version,
  };

  const sent = sendToDevice(deviceId, {
    v: 1,
    type: MESSAGE_TYPES.ASSET_DELIVER,
    id: randomId('assetdeliver'),
    ts: Date.now(),
    from: 'coordinator',
    to: deviceId,
    payload,
  });

  if (sent) {
    updateDeliveryStatus(delivery.id, 'sending');
    return { ...delivery, status: 'sending' };
  }
  updateDeliveryStatus(delivery.id, 'failed', { error: 'send_failed' });
  return { ...delivery, status: 'failed', error: 'send_failed' };
}

/** 执行分发（actionGuard 确认后触发） */
export async function executeDelivery(deliveryId: string): Promise<AssetDelivery[]> {
  const req = pendingRequests.get(deliveryId);
  if (!req) return [];
  pendingRequests.delete(deliveryId);

  const results: AssetDelivery[] = [];
  for (const assetId of req.assetIds) {
    for (const deviceId of req.targets) {
      results.push(sendToTarget(assetId, deviceId));
    }
  }
  return results;
}

/** 回收 asset.deliver_ack（设备 → 协调） */
export function handleAssetDeliverAck(rawAck: unknown): void {
  const ack = rawAck as AssetDeliverAck | null;
  if (!ack?.deliveryId) return;
  if (ack.status === 'delivered') {
    updateDeliveryStatus(ack.deliveryId, 'delivered');
  } else {
    updateDeliveryStatus(ack.deliveryId, 'failed', { error: ack.error ?? 'deliver_failed' });
  }
}

/** 补发待处理（离线设备上线后） */
function sweepPending(): void {
  const pendings = listPendingDeliveries();
  for (const d of pendings) {
    if (d.status !== 'pending') continue;
    if (!deviceRegistry.isOnline(d.deviceId)) continue;
    const asset = getAsset(d.assetId);
    if (!asset) {
      updateDeliveryStatus(d.id, 'failed', { error: 'asset_not_found' });
      continue;
    }
    const sent = sendToDevice(d.deviceId, {
      v: 1,
      type: MESSAGE_TYPES.ASSET_DELIVER,
      id: randomId('assetdeliver'),
      ts: Date.now(),
      from: 'coordinator',
      to: d.deviceId,
      payload: {
        deliveryId: d.id,
        assetId: asset.id,
        kind: asset.kind,
        name: asset.name,
        content: asset.content,
        contentType: asset.contentType,
        version: asset.version,
      } satisfies AssetDeliver,
    });
    if (sent) updateDeliveryStatus(d.id, 'sending');
  }
}

/** 启动补发定时器（离线排队语义） */
export function startDeliverySweeper(intervalMs = 5_000): NodeJS.Timeout {
  const timer = setInterval(() => sweepPending(), intervalMs);
  timer.unref();
  return timer;
}

/** 分发记录列表 */
export function listDeliveryRecords(filter?: { status?: AssetDelivery['status']; deviceId?: string }): AssetDelivery[] {
  return listDeliveries(filter);
}

/** 注册 actionGuard 执行器 */
export function registerDeliveryExecutor(): void {
  actionGuard.registerExecutor('asset_deliver', (refId) => {
    void executeDelivery(refId);
  });
}
