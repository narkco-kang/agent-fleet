import type { FastifyInstance } from 'fastify';
import type { RoleRoute } from '@agentmesh/shared';
import { roleRouteStore } from '../services/routing/roleRouteStore.js';
import { roleRouter } from '../services/routing/roleRouter.js';
import { modelGatewayClient } from '../services/routing/modelGatewayClient.js';
import { getUsageSummary, listUsageRecords } from '../services/routing/usageLedger.js';
import {
  collectFreeSourceRefs,
  probeAllFreeSources,
  probeFreeSources,
} from '../services/routing/freeSourceService.js';
import {
  DIRECT_FREE_SOURCES,
  listDirectModels,
  probeDirectSource,
} from '@agentmesh/shared';
import { checkin, status as checkinStatus } from '../services/routing/checkinService.js';

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

  /** 收集当前角色路由中的免费源 ref */
  app.get('/api/routing/free-sources', async () => {
    return { ok: true, data: { sources: collectFreeSourceRefs() } };
  });

  /** 真实探测免费源是否可用；如网关提示需要签到/打卡，则自动尝试后重试 */
  app.post<{ Body: { autoCheckin?: boolean; timeoutMs?: number } }>('/api/routing/free-sources/probe', async (req) => {
    const body = req.body ?? {};
    const report = await probeFreeSources({
      autoCheckin: body.autoCheckin !== false,
      timeoutMs: body.timeoutMs,
    });
    return { ok: true, data: report };
  });

  /** 直连公开免费源目录（Kilo / OpenCode，参考 dsh-our-free-model） */
  app.get('/api/routing/free-sources/catalog', async () => {
    return {
      ok: true,
      data: DIRECT_FREE_SOURCES.map((s) => ({
        id: s.id,
        label: s.label,
        baseUrl: s.baseUrl,
        models: s.models,
        auth: s.auth,
        quotaBased: s.quotaBased,
        note: s.note,
        docs: s.docs,
      })),
    };
  });

  /** 列出直连源的模型池（含免费筛选） */
  app.get<{ Params: { id: string } }>('/api/routing/free-sources/catalog/:id/models', async (req, reply) => {
    const res = await listDirectModels(req.params.id);
    if (!res.ok && res.error === 'source_not_found') {
      return reply.code(404).send({ ok: false, error: 'source_not_found' });
    }
    return { ok: res.ok, data: res };
  });

  /** 真实探测单个直连源（发最小 chat 请求） */
  app.post<{ Body: { sourceId: string; model?: string; timeoutMs?: number } }>(
    '/api/routing/free-sources/probe-direct',
    async (req, reply) => {
      const { sourceId, model, timeoutMs } = req.body ?? {};
      if (!sourceId) return reply.code(400).send({ ok: false, error: 'sourceId required' });
      const result = await probeDirectSource(sourceId, model, { timeoutMs });
      return { ok: true, data: result };
    },
  );

  /** 综合探测：modelgateway 免费线路 + 直连公开免费源 */
  app.post<{ Body: { autoCheckin?: boolean; timeoutMs?: number } }>(
    '/api/routing/free-sources/probe-all',
    async (req) => {
      const body = req.body ?? {};
      const report = await probeAllFreeSources({
        autoCheckin: body.autoCheckin !== false,
        timeoutMs: body.timeoutMs,
      });
      return { ok: true, data: report };
    },
  );

  /** 手动触发签到（对需要签到获取积分的免费源） */
  app.post<{ Body: { sourceId?: string } }>('/api/routing/free-sources/checkin', async (req) => {
    const results = await checkin((req.body ?? {}).sourceId);
    return { ok: true, data: results };
  });

  /** 签到源状态 + 审计记录 */
  app.get('/api/routing/free-sources/checkin/status', async () => {
    return { ok: true, data: checkinStatus() };
  });
}
