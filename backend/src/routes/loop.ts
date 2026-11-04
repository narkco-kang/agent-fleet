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

  /** 编排 DAG 图（P2-10）：steps 节点 + dependsOn 边 + 运行时状态 + 决策门 */
  app.get<{ Params: { id: string } }>('/api/loops/:id/graph', async (req, reply) => {
    const loop = loopService.get(req.params.id);
    if (!loop) return reply.code(404).send({ ok: false, error: 'loop_not_found' });
    const statuses = loopScheduler.stepStatuses(req.params.id);
    const nodes = loop.steps.map((s) => ({
      id: s.id,
      name: s.name,
      operator: s.operator ?? 'sequence',
      status: statuses[s.id]?.status ?? (loop.state === 'running' ? 'queued' : 'idle'),
      human: statuses[s.id]?.human ?? false,
      taskIds: statuses[s.id]?.taskIds ?? [],
    }));
    const edges = loop.steps.flatMap((s) =>
      s.dependsOn.map((depId) => ({ from: depId, to: s.id })),
    );
    return { ok: true, data: { loopId: loop.id, state: loop.state, currentRound: loop.currentRound, nodes, edges } };
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

  /** 人工步骤 resolve（human 算子，HITL） */
  app.post<{ Params: { id: string; stepId: string } }>(
    '/api/loops/:id/steps/:stepId/resolve',
    async (req, reply) => {
      if (!loopScheduler.resolveHumanStep(req.params.id, req.params.stepId)) {
        return reply.code(409).send({ ok: false, error: 'step_not_resolvable' });
      }
      return { ok: true };
    },
  );

  /** 删除 */
  app.delete<{ Params: { id: string } }>('/api/loops/:id', async (req) => {
    loopScheduler.cancel(req.params.id);
    loopService.remove(req.params.id);
    return { ok: true };
  });
}
