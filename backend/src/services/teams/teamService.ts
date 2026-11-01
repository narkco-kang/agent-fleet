import type { RoleRoute, RoleRoutingDecision, Team, TeamMember } from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from '../../db/repo/teams.js';
import { roleRouter } from '../routing/roleRouter.js';

/**
 * 专家团队服务：Team CRUD + resolveTeamRoutes（复用 roleRouter 决策，不新造）。
 */

export interface TeamCreateInput {
  name: string;
  members?: TeamMember[];
  routes?: Record<string, RoleRoute>;
}

export interface TeamUpdateInput {
  name?: string;
  members?: TeamMember[];
  routes?: Record<string, RoleRoute>;
}

/** 创建团队（成员 deviceId 可空，Q8） */
export function create(input: TeamCreateInput): Team {
  if (!input.name || typeof input.name !== 'string') {
    throw new Error('team name required');
  }
  return createTeam({
    teamId: randomId('team'),
    name: input.name,
    members: input.members ?? [],
    routes: input.routes ?? {},
  });
}

export function get(teamId: string): Team | undefined {
  return getTeam(teamId);
}

export function list(): Team[] {
  return listTeams();
}

export function update(teamId: string, patch: TeamUpdateInput): Team | undefined {
  return updateTeam(teamId, {
    name: patch.name,
    members: patch.members,
    routes: patch.routes,
  });
}

export function remove(teamId: string): void {
  deleteTeam(teamId);
}

/**
 * 逐成员复用 roleRouter.decide，返回 role → 决策映射。
 * - 成员显式指定 deviceId + agentType 时，构造本地绑定路由优先决策。
 * - 否则使用团队自定义 routes（team.routes）或全局角色路由表。
 */
export function resolveTeamRoutes(teamId: string): Record<string, RoleRoutingDecision | null> {
  const team = getTeam(teamId);
  if (!team) return {};

  const result: Record<string, RoleRoutingDecision | null> = {};
  for (const member of team.members) {
    // 成员显式绑定优先
    if (member.deviceId && member.agentType) {
      const localRoute: RoleRoute = {
        role: member.role,
        primary: 'local',
        fallback: [],
        capability: 'chat',
        bots: [],
        deviceId: member.deviceId,
        agentType: member.agentType,
        enabled: true,
      };
      result[member.role] = roleRouter.decide(member.role, {}, { [member.role]: localRoute });
      continue;
    }
    result[member.role] = roleRouter.decide(member.role, {}, team.routes);
  }
  return result;
}
