import type { FastifyInstance } from 'fastify';
import type { RoleRoute, TeamMember } from '@agentmesh/shared';
import * as teamService from '../services/teams/teamService.js';

/**
 * 专家团队 REST 出口。
 */
export function registerTeamRoutes(app: FastifyInstance): void {
  /** 创建团队 */
  app.post<{
    Body: {
      name: string;
      description?: string;
      purpose?: string;
      members?: TeamMember[];
      routes?: Record<string, RoleRoute>;
    };
  }>('/api/teams', async (req, reply) => {
    try {
      const team = teamService.create(req.body ?? {});
      return { ok: true, data: team };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  /** 团队列表 */
  app.get('/api/teams', async () => {
    return { ok: true, data: teamService.list() };
  });

  /** 团队详情 */
  app.get<{ Params: { id: string } }>('/api/teams/:id', async (req, reply) => {
    const team = teamService.get(req.params.id);
    if (!team) return reply.code(404).send({ ok: false, error: 'team_not_found' });
    return { ok: true, data: team };
  });

  /** 团队角色路由解析（复用 roleRouter） */
  app.get<{ Params: { id: string } }>('/api/teams/:id/routes', async (req, reply) => {
    const team = teamService.get(req.params.id);
    if (!team) return reply.code(404).send({ ok: false, error: 'team_not_found' });
    return { ok: true, data: teamService.resolveTeamRoutes(req.params.id) };
  });

  /** 团队绑定的设备（含成员显式绑定） */
  app.get<{ Params: { id: string } }>('/api/teams/:id/devices', async (req, reply) => {
    if (!teamService.get(req.params.id)) {
      return reply.code(404).send({ ok: false, error: 'team_not_found' });
    }
    return { ok: true, data: { deviceIds: teamService.teamDeviceIds(req.params.id) } };
  });

  /** 批量绑定设备到团队（A 设备=软件开发团队，B 设备=内容专家团队） */
  app.post<{ Params: { id: string }; Body: { deviceIds?: string[] } }>(
    '/api/teams/:id/devices',
    async (req, reply) => {
      const { deviceIds = [] } = req.body ?? {};
      if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
        return reply.code(400).send({ ok: false, error: 'deviceIds required' });
      }
      try {
        return { ok: true, data: teamService.bindDevices(req.params.id, deviceIds) };
      } catch (err) {
        const msg = (err as Error).message;
        return reply.code(msg === 'team_not_found' ? 404 : 400).send({ ok: false, error: msg });
      }
    },
  );

  /** 解绑设备 */
  app.delete<{ Params: { id: string; deviceId: string } }>(
    '/api/teams/:id/devices/:deviceId',
    async (req, reply) => {
      try {
        const ok = teamService.unbindDevice(req.params.deviceId, req.params.id);
        return { ok: true, data: { unbound: ok } };
      } catch (err) {
        return reply.code(404).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  /** 设备 → 团队绑定总览 */
  app.get('/api/device-teams', async () => {
    return { ok: true, data: teamService.listBindings() };
  });

  /** 更新团队 */
  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      purpose?: string;
      members?: TeamMember[];
      routes?: Record<string, RoleRoute>;
    };
  }>('/api/teams/:id', async (req, reply) => {
    const team = teamService.update(req.params.id, req.body ?? {});
    if (!team) return reply.code(404).send({ ok: false, error: 'team_not_found' });
    return { ok: true, data: team };
  });

  /** 删除团队 */
  app.delete<{ Params: { id: string } }>('/api/teams/:id', async (req) => {
    teamService.remove(req.params.id);
    return { ok: true };
  });
}
