import type { FastifyInstance } from 'fastify';
import type { AssetContentType, AssetKind } from '@agentmesh/shared';
import * as assetService from '../services/assets/assetService.js';
import {
  handleAssetDeliverAck,
  listDeliveryRecords,
  requestDelivery,
} from '../services/assets/deliveryService.js';
import { actionGuard } from '../services/actionGuard.js';

/**
 * 资产 REST 出口：Asset CRUD + 分发（人工确认）。
 */
export function registerAssetRoutes(app: FastifyInstance): void {
  /** 创建资产 */
  app.post<{
    Body: { kind: AssetKind; name: string; content: string; contentType?: AssetContentType; tags?: string[] };
  }>('/api/assets', async (req, reply) => {
    try {
      const asset = assetService.create(req.body ?? {});
      return { ok: true, data: asset };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** 资产列表 */
  app.get<{ Querystring: { kind?: string } }>('/api/assets', async (req) => {
    const assets = assetService.list({ kind: req.query.kind as AssetKind | undefined });
    return { ok: true, data: assets };
  });

  /** 资产详情 */
  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const asset = assetService.get(req.params.id);
    if (!asset) return reply.code(404).send({ ok: false, error: 'asset_not_found' });
    return { ok: true, data: asset };
  });

  /** 更新资产（version 递增） */
  app.put<{
    Params: { id: string };
    Body: { name?: string; content?: string; contentType?: AssetContentType; tags?: string[] };
  }>('/api/assets/:id', async (req, reply) => {
    const asset = assetService.update(req.params.id, req.body ?? {});
    if (!asset) return reply.code(404).send({ ok: false, error: 'asset_not_found' });
    return { ok: true, data: asset };
  });

  /** 删除资产 */
  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (req) => {
    assetService.remove(req.params.id);
    return { ok: true };
  });

  /** 请求分发（返回人工确认态） */
  app.post<{ Body: { assetIds: string[]; targets: string[] } }>('/api/assets/deliver', async (req, reply) => {
    const { assetIds, targets } = req.body ?? {};
    if (!Array.isArray(assetIds) || assetIds.length === 0 || !Array.isArray(targets) || targets.length === 0) {
      return reply.code(400).send({ ok: false, error: 'assetIds and targets required' });
    }
    const result = requestDelivery(assetIds, targets);
    return { ok: true, data: result };
  });

  /** 确认分发（id = deliveryId / batchId） */
  app.post<{ Params: { id: string } }>('/api/assets/deliver/:id/confirm', async (req, reply) => {
    const confirmation = actionGuard.confirmByRef('asset_deliver', req.params.id, 'dashboard-user');
    if (!confirmation) {
      return reply.code(404).send({ ok: false, error: 'confirmation_not_found' });
    }
    return { ok: true, data: confirmation };
  });

  /** 分发记录列表 */
  app.get<{ Querystring: { status?: string; deviceId?: string } }>('/api/assets/deliveries', async (req) => {
    const deliveries = listDeliveryRecords({
      status: req.query.status as never,
      deviceId: req.query.deviceId,
    });
    return { ok: true, data: deliveries };
  });
}

/** 供 index.ts 注入的 ack 处理器 */
export function onAssetDeliverAck(ack: unknown): void {
  handleAssetDeliverAck(ack as never);
}
