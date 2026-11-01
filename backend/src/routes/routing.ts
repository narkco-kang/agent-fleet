import type { FastifyInstance } from 'fastify';
import type { RoleRoute } from '@agentmesh/shared';
import { roleRouteStore } from '../services/routing/roleRouteStore.js';
import { roleRouter } from '../services/routing/roleRouter.js';
import { modelGatewayClient } from '../services/routing/modelGatewayClient.js';
import { getUsageSummary, listUsageRecords } from '../services/routing/usageLedger.js';

/**
 * 路由网关 REST 出口：角色路由 CRUD/导入 + 决策 + 台账 + 网关健康。
 */
export function registerRoutingRoutes(app: FastifyInstance): void {
  /** 角色路由列表 */
  app.get('/api/routing/roles', async () => {
    return { ok: true, data: roleRouteStore.list() };
  });

  /** 写入单个角色路由 */
  app.post<{ Body: RoleRoute }>('/api/routing/roles', async (req, reply) => {
    const route = req.body ?? {};
    if (!route.role || typeof route.role !== 'string' || !route.primary) {
      return reply.code(400).send({ ok: false, error: 'role and primary required' });
    }
    roleRouteStore.set(route);
    return { ok: true, data: roleRouteStore.get(route.role) };
  });

  /** 导入角色路由（body: { json?: string; path?: string } 或直接对象/数组） */
  app.post<{ Body: unknown }>('/api/routing/roles/import', async (req, reply) => {
    const body = (req.body ?? {}) as { json?: string; path?: string };
    try {
      if (body.path) {
        const n = roleRouteStore.importFromJsonFile(body.path);
        return { ok: true, data: { imported: n } };
      }
      if (typeof body.json === 'string') {
        const n = roleRouteStore.importFromJson(body.json);
        return { ok: true, data: { imported: n } };
      }
      // 直接传对象/数组
      const n = roleRouteStore.importFromObject(req.body);
      return { ok: true, data: { imported: n } };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** 删除角色路由 */
  app.delete<{ Params: { role: string } }>('/api/routing/roles/:role', async (req) => {
    roleRouteStore.delete(req.params.role);
    return { ok: true };
  });

  /** 角色路由决策 */
  app.post<{ Body: { role: string; preferLocal?: boolean } }>('/api/routing/decide', async (req, reply) => {
    const { role, preferLocal } = req.body ?? {};
    if (!role) {
      return reply.code(400).send({ ok: false, error: 'role required' });
    }
    const decision = roleRouter.decide(role, { preferLocal });
    return { ok: true, data: decision };
  });

  /** token 台账摘要 */
  app.get('/api/routing/usage', async () => {
    return { ok: true, data: getUsageSummary() };
  });

  /** token 台账明细 */
  app.get('/api/routing/usage/records', async () => {
    return { ok: true, data: listUsageRecords() };
  });

  /** modelgateway 健康 */
  app.get('/api/routing/gateway/health', async () => {
    const healthy = await modelGatewayClient.health();
    return {
      ok: true,
      data: { configured: modelGatewayClient.isConfigured(), available: modelGatewayClient.isAvailable(), healthy },
    };
  });
}
