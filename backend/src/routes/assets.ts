import type { FastifyInstance } from 'fastify';
import type { AssetContentType, AssetKind, AssetSource } from '@agentfleet/shared';
import * as assetService from '../services/assets/assetService.js';
import {
  handleAssetDeliverAck,
  listDeliveryRecords,
  requestDelivery,
} from '../services/assets/deliveryService.js';
import { actionGuard } from '../services/actionGuard.js';
import { staleDeliveries } from '../db/repo/assetDeliveries.js';

/** multipart 部件（版本无关的最小接口） */
type MultipartPart =
  | { type: 'file'; fieldname: string; filename: string; toBuffer: () => Promise<Buffer> }
  | { type: 'field'; fieldname: string; value: string };

/**
 * 资产 REST 出口：Asset CRUD + 分发（人工确认）。
 * 支持文本（JSON）与二进制文件（multipart，存 base64 + contentType=file）两种创建方式。
 */
export function registerAssetRoutes(app: FastifyInstance): void {
  /** 创建资产（JSON 文本 / multipart 二进制文件） */
  app.post<{
    Body: {
      kind: AssetKind;
      name: string;
      description?: string;
      source?: AssetSource;
      content: string;
      contentType?: AssetContentType;
      tags?: string[];
    };
  }>('/api/assets', async (req, reply) => {
    const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
    if (isMultipart) {
      let kind = 'skill';
      let name = '';
      let description = '';
      let source: AssetSource = 'imported';
      let buffer: Buffer | null = null;
      for await (const part of (req as unknown as { parts(): AsyncIterable<MultipartPart> }).parts()) {
        if (part.type === 'file') {
          buffer = await part.toBuffer();
          if (!name) name = part.filename || 'asset';
        } else if (part.type === 'field' && part.fieldname === 'kind') {
          kind = part.value;
        } else if (part.type === 'field' && part.fieldname === 'name') {
          name = part.value;
        } else if (part.type === 'field' && part.fieldname === 'description') {
          description = part.value;
        } else if (part.type === 'field' && part.fieldname === 'source') {
          source = part.value as AssetSource;
        }
      }
      if (!buffer) return reply.code(400).send({ ok: false, error: 'file required' });
      try {
        const asset = assetService.create({
          kind: kind as AssetKind,
          name: name || 'asset',
          description,
          source,
          content: buffer.toString('base64'),
          contentType: 'file',
        });
        return { ok: true, data: asset };
      } catch (err) {
        return reply.code(400).send({ ok: false, error: (err as Error).message });
      }
    }

    try {
      const asset = assetService.create(req.body ?? {});
      return { ok: true, data: asset };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** 批量上传（multipart 多文件 → 每个文件一个资产，用于 skills/规则批量导入） */
  app.post<{
    Body: { kind?: AssetKind; description?: string; source?: AssetSource };
  }>('/api/assets/batch', async (req, reply) => {
    const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
    if (!isMultipart) {
      return reply.code(400).send({ ok: false, error: 'multipart/form-data required' });
    }

    let kind: AssetKind = 'skill';
    let description = '';
    let source: AssetSource = 'imported';
    const files: Array<{ name: string; buffer: Buffer }> = [];

    for await (const part of (req as unknown as { parts(): AsyncIterable<MultipartPart> }).parts()) {
      if (part.type === 'file') {
        files.push({ name: part.filename || `file-${files.length + 1}`, buffer: await part.toBuffer() });
      } else if (part.type === 'field' && part.fieldname === 'kind') {
        kind = part.value as AssetKind;
      } else if (part.type === 'field' && part.fieldname === 'description') {
        description = part.value;
      } else if (part.type === 'field' && part.fieldname === 'source') {
        source = part.value as AssetSource;
      }
    }

    if (files.length === 0) return reply.code(400).send({ ok: false, error: 'at least one file required' });

    const created = files.map((f) =>
      assetService.create({
        kind,
        name: f.name,
        description,
        source,
        content: f.buffer.toString('base64'),
        contentType: 'file',
      }),
    );

    return { ok: true, data: { created, count: created.length } };
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
    Body: {
      name?: string;
      description?: string;
      source?: AssetSource;
      content?: string;
      contentType?: AssetContentType;
      tags?: string[];
    };
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

  /** 陈旧工作区检测：设备已分发资产版本落后于最新基线的清单（提示重新分发）。 */
  app.get('/api/assets/stale', async () => {
    return { ok: true, data: staleDeliveries() };
  });
}

/** 供 index.ts 注入的 ack 处理器 */
export function onAssetDeliverAck(ack: unknown): void {
  handleAssetDeliverAck(ack as never);
}
