import type { FastifyInstance } from 'fastify';
import { parseExcel, parseTargetsFromObjects } from '../services/deploy/excelParser.js';
import {
  createDeployBatch,
  createUninstallBatch,
  getBatchView,
} from '../services/deploy/deployService.js';
import { listBatches, updateBatchStatus } from '../db/repo/deployments.js';
import type { DeploymentKind } from '@agentmesh/shared';
import { actionGuard } from '../services/actionGuard.js';
import { config } from '../config.js';

/** multipart 部件（版本无关的最小接口，避免依赖 @fastify/multipart 类型细节） */
type MultipartPart =
  | { type: 'file'; fieldname: string; toBuffer: () => Promise<Buffer> }
  | { type: 'field'; fieldname: string; value: string };

/**
 * 批量部署 REST 出口：上传 .xlsx → 解析 → 人工确认 → 执行。
 */
export function registerDeployRoutes(app: FastifyInstance): void {
  /** 上传 Excel 创建部署批次 */
  app.post('/api/deploy/batches', async (req, reply) => {
    if (!config.deployEnabled) {
      return reply.code(403).send({ ok: false, error: 'deploy disabled' });
    }

    let name = (req.query as { name?: string }).name ?? 'deploy-batch';
    let buffer: Buffer | null = null;

    // 仅当 Content-Type 为 multipart/form-data 时解析文件上传
    const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
    if (isMultipart) {
      for await (const part of (req as unknown as { parts(): AsyncIterable<MultipartPart> }).parts()) {
        if (part.type === 'file') {
          buffer = await part.toBuffer();
        } else if (part.type === 'field' && part.fieldname === 'name') {
          name = part.value;
        }
      }
    }

    // JSON fallback：base64 或 targets 数组
    const body = (req.body ?? {}) as {
      name?: string;
      base64?: string;
      targets?: Array<Record<string, unknown>>;
    };

    if (!buffer && typeof body.base64 === 'string') {
      buffer = Buffer.from(body.base64, 'base64');
      if (body.name) name = body.name;
    }

    if (!buffer && Array.isArray(body.targets)) {
      const { targets, invalidRows } = parseTargetsFromObjects(body.targets);
      const result = createDeployBatch(body.name ?? name, targets, invalidRows);
      return { ok: true, data: result };
    }

    if (!buffer) {
      return reply.code(400).send({ ok: false, error: 'file or base64/targets required' });
    }

    const { targets, invalidRows } = parseExcel(buffer);
    const result = createDeployBatch(name, targets, invalidRows);
    return { ok: true, data: result };
  });

  /** 上传 Excel / JSON 创建卸载批次（一键卸载 agent 平台） */
  app.post('/api/deploy/uninstall-batches', async (req, reply) => {
    if (!config.deployEnabled) {
      return reply.code(403).send({ ok: false, error: 'deploy disabled' });
    }

    let name = (req.query as { name?: string }).name ?? 'uninstall-batch';
    let buffer: Buffer | null = null;
    const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
    if (isMultipart) {
      for await (const part of (req as unknown as { parts(): AsyncIterable<MultipartPart> }).parts()) {
        if (part.type === 'file') buffer = await part.toBuffer();
        else if (part.type === 'field' && part.fieldname === 'name') name = part.value;
      }
    }

    const body = (req.body ?? {}) as {
      name?: string;
      base64?: string;
      targets?: Array<Record<string, unknown>>;
    };
    if (!buffer && typeof body.base64 === 'string') {
      buffer = Buffer.from(body.base64, 'base64');
      if (body.name) name = body.name;
    }

    if (!buffer && Array.isArray(body.targets)) {
      const { targets, invalidRows } = parseTargetsFromObjects(body.targets);
      const result = createUninstallBatch(body.name ?? name, targets, invalidRows);
      return { ok: true, data: result };
    }
    if (!buffer) {
      return reply.code(400).send({ ok: false, error: 'file or base64/targets required' });
    }

    const { targets, invalidRows } = parseExcel(buffer);
    const result = createUninstallBatch(name, targets, invalidRows);
    return { ok: true, data: result };
  });

  /** 批次列表（?kind=deploy|uninstall） */
  app.get<{ Querystring: { kind?: DeploymentKind } }>('/api/deploy/batches', async (req) => {
    return { ok: true, data: listBatches(500, req.query.kind) };
  });

  /** 批次详情（含目标，无密码） */
  app.get<{ Params: { id: string } }>('/api/deploy/batches/:id', async (req, reply) => {
    const batch = getBatchView(req.params.id);
    if (!batch) return reply.code(404).send({ ok: false, error: 'batch_not_found' });
    return { ok: true, data: batch };
  });

  /** 确认部署/卸载（按批次 kind 触发对应执行器） */
  app.post<{ Params: { id: string } }>('/api/deploy/batches/:id/confirm', async (req, reply) => {
    const batch = getBatchView(req.params.id);
    if (!batch) return reply.code(404).send({ ok: false, error: 'batch_not_found' });
    const kind = batch.kind === 'uninstall' ? 'uninstall' : 'deploy';
    const confirmation = actionGuard.confirmByRef(kind, req.params.id, 'dashboard-user');
    if (!confirmation) return reply.code(404).send({ ok: false, error: 'confirmation_not_found' });
    return { ok: true, data: confirmation };
  });

  /** 取消部署（未执行前） */
  app.post<{ Params: { id: string } }>('/api/deploy/batches/:id/cancel', async (req, reply) => {
    const batch = getBatchView(req.params.id);
    if (!batch) return reply.code(404).send({ ok: false, error: 'batch_not_found' });
    if (batch.status === 'running' || batch.status === 'completed') {
      return reply.code(409).send({ ok: false, error: 'batch_not_cancellable' });
    }
    updateBatchStatus(req.params.id, 'cancelled');
    return { ok: true };
  });
}
