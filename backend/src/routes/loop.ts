import type { FastifyInstance } from 'fastify';
import type { LoopStep, LoopTrigger } from '@agentfleet/shared';
import * as loopService from '../services/loop/loopService.js';
import { loopScheduler } from '../services/loop/loopScheduler.js';
import { actionGuard } from '../services/actionGuard.js';

/**
 * Loop 编排 REST 出口（start 需人工确认）。
 */
export function registerLoopRoutes(app: FastifyInstance): void {
  /** 创建 Loop */
  app.post<{
    Body: { name: string; steps?: LoopStep[]; trigger?: LoopTrigger; targets?: string[] };
  }>('/api/loops', async (req, reply) => {
    try {
      const loop = loopService.create(req.body ?? {});
      return { ok: true, data: loop };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** Loop 列表 */
  app.get('/api/loops', async () => {
    return { ok: true, data: loopService.list() };
  });

  /** Loop 详情 */
  app.get<{ Params: { id: string } }>('/api/loops/:id', async (req, reply) => {
    const loop = loopService.get(req.params.id);
    if (!loop) return reply.code(404).send({ ok: false, error: 'loop_not_found' });
    return { ok: true, data: loop };
  });

  /** 启动 Loop（请求人工确认，返回待确认态） */
  app.post<{ Params: { id: string } }>('/api/loops/:id/start', async (req, reply) => {
    const loop = loopService.get(req.params.id);
    if (!loop) return reply.code(404).send({ ok: false, error: 'loop_not_found' });
    if (loop.steps.length === 0) {
      return reply.code(400).send({ ok: false, error: 'loop has no steps' });
    }
    const summary = `Loop 编排启动：${loop.name}（${loop.steps.length} 步）`;
    const confirmation = actionGuard.request('loop_start', loop.id, summary);
    return { ok: true, data: { loopId: loop.id, confirmationId: confirmation.id, status: confirmation.status } };
  });

  /** 确认启动（触发 loopScheduler.start） */
  app.post<{ Params: { id: string } }>('/api/loops/:id/confirm', async (req, reply) => {
    const confirmation = actionGuard.confirmByRef('loop_start', req.params.id, 'dashboard-user');
    if (!confirmation) return reply.code(404).send({ ok: false, error: 'confirmation_not_found' });
    return { ok: true, data: confirmation };
  });

  /** 暂停 */
  app.post<{ Params: { id: string } }>('/api/loops/:id/pause', async (req, reply) => {
    if (!loopScheduler.pause(req.params.id)) {
      return reply.code(409).send({ ok: false, error: 'loop_not_pausable' });
    }
    return { ok: true };
  });

  /** 恢复 */
  app.post<{ Params: { id: string } }>('/api/loops/:id/resume', async (req, reply) => {
    if (!loopScheduler.resume(req.params.id)) {
      return reply.code(409).send({ ok: false, error: 'loop_not_resumable' });
    }
    return { ok: true };
  });

  /** 取消 */
  app.post<{ Params: { id: string } }>('/api/loops/:id/cancel', async (req, reply) => {
    if (!loopScheduler.cancel(req.params.id)) {
      return reply.code(404).send({ ok: false, error: 'loop_not_found' });
    }
    return { ok: true };
  });

  /** 删除 */
  app.delete<{ Params: { id: string } }>('/api/loops/:id', async (req) => {
    loopScheduler.cancel(req.params.id);
    loopService.remove(req.params.id);
    return { ok: true };
  });
}
