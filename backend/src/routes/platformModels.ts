import type { FastifyInstance } from 'fastify';
import type { AgentType } from '@agentfleet/shared';
import * as platformModelService from '../services/routing/platformModelService.js';

/**
 * 平台模型绑定 REST 出口：为「设备 + agent 平台」配置网关模型（部署完成即用 / 故障切换）。
 */
export function registerPlatformModelRoutes(app: FastifyInstance): void {
  /** 列表 */
  app.get('/api/routing/platform-models', async () => {
    return { ok: true, data: platformModelService.list() };
  });

  /** 绑定（或覆盖）单条平台模型 */
  app.post<{
    Body: { deviceId: string; agentType: AgentType; model: string; fallbacks?: string[] };
  }>('/api/routing/platform-models', async (req, reply) => {
    const { deviceId, agentType, model, fallbacks } = req.body ?? {};
    if (!deviceId || !agentType || !model) {
      return reply.code(400).send({ ok: false, error: 'deviceId/agentType/model required' });
    }
    try {
      return { ok: true, data: platformModelService.bind(deviceId, agentType, model, fallbacks ?? []) };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** 解绑 */
  app.delete<{ Params: { deviceId: string; agentType: AgentType } }>(
    '/api/routing/platform-models/:deviceId/:agentType',
    async (req) => {
      const n = platformModelService.unbind(req.params.deviceId, req.params.agentType);
      return { ok: true, data: { removed: n } };
    },
  );

  /** 手动切换模型（故障恢复） */
  app.post<{ Params: { deviceId: string; agentType: AgentType }; Body: { model: string } }>(
    '/api/routing/platform-models/:deviceId/:agentType/switch',
    async (req, reply) => {
      const { model } = req.body ?? {};
      if (!model) return reply.code(400).send({ ok: false, error: 'model required' });
      try {
        const res = platformModelService.switchModel(req.params.deviceId, req.params.agentType, model);
        if (!res) return reply.code(404).send({ ok: false, error: 'binding_not_found' });
        return { ok: true, data: res };
      } catch (err) {
        return reply.code(400).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  /** 手动恢复健康 */
  app.post<{ Params: { deviceId: string; agentType: AgentType } }>(
    '/api/routing/platform-models/:deviceId/:agentType/reset',
    async (req, reply) => {
      const res = platformModelService.reset(req.params.deviceId, req.params.agentType);
      if (!res) return reply.code(404).send({ ok: false, error: 'binding_not_found' });
      return { ok: true, data: res };
    },
  );
}
