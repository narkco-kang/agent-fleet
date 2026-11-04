import type { FastifyInstance } from 'fastify';
import type { AgentType, SwarmPurpose } from '@agentfleet/shared';
import * as swarmService from '../services/swarm/roleTeamService.js';
import type { SubRoleInput } from '../services/swarm/roleTeamService.js';
import { swarmRouter } from '../services/swarm/swarmRouter.js';

/**
 * 蜂群角色团队 REST 出口：团队/子角色 CRUD + 设备软绑定 + 路由决策。
 * 响应统一 { ok, data, error }，error 用 snake_case 常量。
 */
export function registerSwarmRoutes(app: FastifyInstance): void {
  /** 团队列表 */
  app.get('/api/swarm/teams', async () => {
    return { ok: true, data: swarmService.list() };
  });

  /** 创建团队 */
  app.post<{
    Body: {
      name: string;
      slug?: string;
      description?: string;
      purpose?: SwarmPurpose;
      subRoles?: SubRoleInput[];
    };
  }>('/api/swarm/teams', async (req, reply) => {
    try {
      const team = swarmService.create(req.body ?? { name: '' });
      return { ok: true, data: team };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** 团队详情（含子角色） */
  app.get<{ Params: { id: string } }>('/api/swarm/teams/:id', async (req, reply) => {
    const detail = swarmService.detail(req.params.id);
    if (!detail) return reply.code(404).send({ ok: false, error: 'team_not_found' });
    return { ok: true, data: detail };
  });

  /** 更新团队 */
  app.put<{
    Params: { id: string };
    Body: { name?: string; slug?: string; description?: string; purpose?: SwarmPurpose };
  }>('/api/swarm/teams/:id', async (req, reply) => {
    try {
      const team = swarmService.update(req.params.id, req.body ?? {});
      if (!team) return reply.code(404).send({ ok: false, error: 'team_not_found' });
      return { ok: true, data: team };
    } catch (err) {
      const msg = (err as Error).message;
      return reply.code(msg === 'team_not_found' ? 404 : 400).send({ ok: false, error: msg });
    }
  });

  /** 删除团队 */
  app.delete<{ Params: { id: string } }>('/api/swarm/teams/:id', async (req) => {
    swarmService.remove(req.params.id);
    return { ok: true };
  });

  /** 设置/清除团队 Leader 子角色（P2-4：slug=null 清除） */
  app.put<{ Params: { id: string }; Body: { slug?: string | null } }>(
    '/api/swarm/teams/:id/leader',
    async (req, reply) => {
      try {
        const team = swarmService.setLeader(req.params.id, req.body?.slug ?? null);
        if (!team) return reply.code(404).send({ ok: false, error: 'team_not_found' });
        return { ok: true, data: team };
      } catch (err) {
        const msg = (err as Error).message;
        return reply.code(msg === 'sub_role_not_found' ? 404 : 400).send({ ok: false, error: msg });
      }
    },
  );

  /** 团队子角色列表 */
  app.get<{ Params: { id: string } }>('/api/swarm/teams/:id/sub-roles', async (req, reply) => {
    if (!swarmService.get(req.params.id)) {
      return reply.code(404).send({ ok: false, error: 'team_not_found' });
    }
    return { ok: true, data: swarmService.listSubRoles(req.params.id) };
  });

  /** 新增/更新子角色 */
  app.post<{ Params: { id: string }; Body: SubRoleInput }>(
    '/api/swarm/teams/:id/sub-roles',
    async (req, reply) => {
      try {
        const subRole = swarmService.upsertSubRole(req.params.id, req.body ?? {});
        return { ok: true, data: subRole };
      } catch (err) {
        const msg = (err as Error).message;
        return reply.code(msg === 'team_not_found' ? 404 : 400).send({ ok: false, error: msg });
      }
    },
  );

  /** 删除子角色 */
  app.delete<{ Params: { id: string; slug: string } }>(
    '/api/swarm/teams/:id/sub-roles/:slug',
    async (req) => {
      swarmService.removeSubRole(req.params.id, req.params.slug);
      return { ok: true };
    },
  );

  /** 批量绑定设备到团队 */
  app.post<{ Params: { id: string }; Body: { deviceIds?: string[] } }>(
    '/api/swarm/teams/:id/devices',
    async (req, reply) => {
      const { deviceIds = [] } = req.body ?? {};
      if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
        return reply.code(400).send({ ok: false, error: 'device_ids_required' });
      }
      try {
        return { ok: true, data: swarmService.bindDevices(req.params.id, deviceIds) };
      } catch (err) {
        const msg = (err as Error).message;
        return reply.code(msg === 'team_not_found' ? 404 : 400).send({ ok: false, error: msg });
      }
    },
  );

  /** 解绑设备 */
  app.delete<{ Params: { id: string; deviceId: string } }>(
    '/api/swarm/teams/:id/devices/:deviceId',
    async (req, reply) => {
      try {
        const unbound = swarmService.unbindDevice(req.params.deviceId, req.params.id);
        return { ok: true, data: { unbound } };
      } catch (err) {
        return reply.code(404).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  /** 设备 → 蜂群团队绑定总览 */
  app.get('/api/swarm/device-bindings', async () => {
    return { ok: true, data: swarmService.listBindings() };
  });

  /** 读取设备软绑定 */
  app.get<{ Params: { deviceId: string } }>(
    '/api/swarm/devices/:deviceId/sub-role-bindings',
    async (req) => {
      return { ok: true, data: swarmService.deviceSubRoleBindings(req.params.deviceId) };
    },
  );

  /** 设置单个子角色软绑定（agentType=null 解绑） */
  app.put<{ Params: { deviceId: string }; Body: { slug: string; agentType: AgentType | null } }>(
    '/api/swarm/devices/:deviceId/sub-role-binding',
    async (req, reply) => {
      const { slug, agentType } = req.body ?? {};
      if (!slug || typeof slug !== 'string') {
        return reply.code(400).send({ ok: false, error: 'slug_required' });
      }
      try {
        return {
          ok: true,
          data: swarmService.setDeviceSubRoleBinding(req.params.deviceId, slug, agentType ?? null),
        };
      } catch (err) {
        return reply.code(404).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  /** 软绑定路由决策（供调试/预览，不做网关降级） */
  app.post<{ Body: { roleTeamId: string; subRoleSlug?: string } }>(
    '/api/swarm/resolve',
    async (req, reply) => {
      const { roleTeamId, subRoleSlug } = req.body ?? {};
      if (!roleTeamId) return reply.code(400).send({ ok: false, error: 'role_team_id_required' });
      const decision = swarmRouter.resolve({ roleTeamId, subRoleSlug });
      return { ok: true, data: decision };
    },
  );
}
