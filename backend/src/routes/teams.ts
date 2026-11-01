import type { FastifyInstance } from 'fastify';
import type { RoleRoute, TeamMember } from '@agentmesh/shared';
import * as teamService from '../services/teams/teamService.js';

/**
 * 专家团队 REST 出口。
 */
export function registerTeamRoutes(app: FastifyInstance): void {
  /** 创建团队 */
  app.post<{
    Body: { name: string; members?: TeamMember[]; routes?: Record<string, RoleRoute> };
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

  /** 更新团队 */
  app.put<{
    Params: { id: string };
    Body: { name?: string; members?: TeamMember[]; routes?: Record<string, RoleRoute> };
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
