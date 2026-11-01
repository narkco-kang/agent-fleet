import type { FastifyInstance } from 'fastify';
import type { Origin, TargetMode } from '@agentmesh/shared';
import { getTask, listTasks, toTaskSnapshot } from '../db/repo/tasks.js';
import { listMessagesByTask, toTaskEvent } from '../db/repo/messages.js';
import { createSession, getSession, makeTitle } from '../db/repo/sessions.js';
import { enqueueTask } from '../services/scheduler.js';
import { cancelTask, retryTask } from '../services/taskRunner.js';
import { randomId } from '../security/auth.js';

/**
 * 任务 REST 路由：下发 / 列表 / 详情 / 取消 / 重试。
 */
export function registerTaskRoutes(app: FastifyInstance): void {
  /** 新建任务（下发） */
  app.post<{
    Body: {
      prompt: string;
      origin?: Origin;
      originRef?: string;
      sessionId?: string;
      target?: {
        mode?: TargetMode;
        deviceId?: string;
        agentType?: string;
        role?: string;
        requireCapability?: string;
      };
    };
  }>('/api/tasks', async (req, reply) => {
    const body = req.body ?? {};
    if (!body.prompt || typeof body.prompt !== 'string') {
      return reply.code(400).send({ ok: false, error: 'prompt required' });
    }
    const origin: Origin = body.origin ?? 'dashboard';
    const originRef = body.originRef ?? 'dashboard-user';
    const sessionId = body.sessionId ?? randomId('session');
    const mode: TargetMode = body.target?.mode ?? 'auto';

    createSession(sessionId, origin, originRef, makeTitle(body.prompt));
    const taskId = randomId('task');

    enqueueTask({
      taskId,
      sessionId,
      origin,
      originRef,
      prompt: body.prompt,
      targetMode: mode,
      targetDeviceId: body.target?.deviceId,
      targetAgentType: (body.target?.agentType as never) ?? undefined,
      targetRole: body.target?.role,
      requireCapability: body.target?.requireCapability,
    });

    return { ok: true, data: { taskId, sessionId, status: 'queued' } };
  });

  /** 任务列表 */
  app.get<{ Querystring: { status?: string; deviceId?: string; agentType?: string } }>(
    '/api/tasks',
    async (req) => {
      const tasks = listTasks(
        {
          status: req.query.status as never,
          deviceId: req.query.deviceId,
          agentType: req.query.agentType as never,
        },
        200,
      ).map(toTaskSnapshot);
      return { ok: true, data: tasks };
    },
  );

  /** 任务详情（含消息流时间线） */
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const row = getTask(req.params.id);
    if (!row) {
      return reply.code(404).send({ ok: false, error: 'task_not_found' });
    }
    const messages = listMessagesByTask(req.params.id).map(toTaskEvent);
    const session = getSession(row.session_id);
    return { ok: true, data: { ...toTaskSnapshot(row), messages, sessionTitle: session?.title ?? '' } };
  });

  /** 取消任务 */
  app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', async (req, reply) => {
    const ok = cancelTask(req.params.id, 'user_cancel');
    if (!ok) {
      return reply.code(409).send({ ok: false, error: 'task_not_cancellable' });
    }
    return { ok: true };
  });

  /** 重试任务 */
  app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', async (req, reply) => {
    const newTaskId = retryTask(req.params.id);
    if (!newTaskId) {
      return reply.code(404).send({ ok: false, error: 'task_not_found' });
    }
    return { ok: true, data: { taskId: newTaskId } };
  });
}
