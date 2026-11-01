import type {
  DeviceTeamBinding,
  RoleRoute,
  RoleRoutingDecision,
  Team,
  TeamMember,
} from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from '../../db/repo/teams.js';
import {
  getDevice,
  listDevicesByTeam,
  listDeviceTeams,
  setDeviceTeam,
  setDeviceTeams,
} from '../../db/repo/devices.js';
import { roleRouter } from '../routing/roleRouter.js';

/**
 * 专家团队服务：Team CRUD + 设备绑定 + resolveTeamRoutes（复用 roleRouter 决策，不新造）。
 *
 * 多设备团队模式：每台设备可绑定一个团队（devices.team_id），
 * 例如 A 设备=软件开发团队、B 设备=内容专家团队；任务可用 target.mode='team'
 * 指定团队，调度器只在该团队绑定的设备上选目标。
 */

export interface TeamCreateInput {
  name: string;
  description?: string;
  purpose?: string;
  members?: TeamMember[];
  routes?: Record<string, RoleRoute>;
}

export interface TeamUpdateInput {
  name?: string;
  description?: string;
  purpose?: string;
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
    description: input.description,
    purpose: input.purpose,
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
    description: patch.description,
    purpose: patch.purpose,
    members: patch.members,
    routes: patch.routes,
  });
}

export function remove(teamId: string): void {
  // 先解绑该团队下所有设备，避免设备指向不存在的团队
  setDeviceTeams(listDevicesByTeam(teamId), null);
  deleteTeam(teamId);
}

/** 设备绑定团队（校验团队存在） */
export function bindDevice(teamId: string, deviceId: string): boolean {
  if (!getTeam(teamId)) throw new Error('team_not_found');
  if (!getDevice(deviceId)) throw new Error('device_not_found');
  return setDeviceTeam(deviceId, teamId);
}

/** 批量绑定设备到团队 */
export function bindDevices(teamId: string, deviceIds: string[]): { changed: number; missing: string[] } {
  if (!getTeam(teamId)) throw new Error('team_not_found');
  const missing = deviceIds.filter((id) => !getDevice(id));
  const changed = setDeviceTeams(
    deviceIds.filter((id) => !missing.includes(id)),
    teamId,
  );
  return { changed, missing };
}

/** 解绑设备（可指定团队，避免误删其它团队绑定） */
export function unbindDevice(deviceId: string, teamId?: string): boolean {
  if (!getDevice(deviceId)) throw new Error('device_not_found');
  if (teamId && listDevicesByTeam(teamId).includes(deviceId) === false) return false;
  return setDeviceTeam(deviceId, null);
}

/** 团队绑定的设备 id 列表（设备绑定 + 成员显式 deviceId 的并集） */
export function teamDeviceIds(teamId: string): string[] {
  const team = getTeam(teamId);
  if (!team) return [];
  const ids = new Set(listDevicesByTeam(teamId));
  for (const m of team.members) if (m.deviceId) ids.add(m.deviceId);
  return Array.from(ids);
}

/** 设备 → 团队绑定视图（全量） */
export function listBindings(): DeviceTeamBinding[] {
  const map = listDeviceTeams();
  const teams = new Map(listTeams().map((t) => [t.id, t]));
  const out: DeviceTeamBinding[] = [];
  for (const [deviceId, teamId] of map) {
    const team = teams.get(teamId);
    if (!team) continue;
    out.push({ deviceId, teamId, teamName: team.name, purpose: team.purpose });
  }
  return out;
}

/** 查询设备绑定的团队（含解析后的角色路由） */
export function getTeamForDevice(
  deviceId: string,
): { team: Team; routes: Record<string, RoleRoutingDecision | null> } | null {
  const teamId = listDeviceTeams().get(deviceId);
  if (!teamId) return null;
  const team = getTeam(teamId);
  if (!team) return null;
  return { team, routes: resolveTeamRoutes(teamId) };
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
