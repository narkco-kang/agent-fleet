import { getDb } from '../database.js';
import type { RoleRoute, Team, TeamMember } from '@agentfleet/shared';

/**
 * 团队表（teams）CRUD（members/routes 存 JSON）。
 */

export interface TeamRow {
  team_id: string;
  name: string;
  description: string;
  purpose: string;
  members: string;
  routes: string;
  created_at: number;
  updated_at: number;
}

/** 行 → shared.Team */
export function rowToTeam(row: TeamRow): Team {
  return {
    id: row.team_id,
    name: row.name,
    description: row.description ?? '',
    purpose: row.purpose ?? 'general',
    members: JSON.parse(row.members || '[]') as TeamMember[],
    routes: JSON.parse(row.routes || '{}') as Record<string, RoleRoute>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 创建团队 */
export function createTeam(input: {
  teamId: string;
  name: string;
  description?: string;
  purpose?: string;
  members?: TeamMember[];
  routes?: Record<string, RoleRoute>;
}): Team {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO teams (team_id, name, description, purpose, members, routes, created_at, updated_at)
       VALUES (@teamId, @name, @description, @purpose, @members, @routes, @now, @now)`,
    )
    .run({
      teamId: input.teamId,
      name: input.name,
      description: input.description ?? '',
      purpose: input.purpose ?? 'general',
      members: JSON.stringify(input.members ?? []),
      routes: JSON.stringify(input.routes ?? {}),
      now,
    });
  return getTeam(input.teamId) as Team;
}

/** 查询团队 */
export function getTeam(teamId: string): Team | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM teams WHERE team_id = ?`)
    .get(teamId) as TeamRow | undefined;
  return row ? rowToTeam(row) : undefined;
}

/** 列表 */
export function listTeams(limit = 500): Team[] {
  const rows = getDb()
    .prepare(`SELECT * FROM teams ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as TeamRow[];
  return rows.map(rowToTeam);
}

/** 更新团队 */
export function updateTeam(
  teamId: string,
  patch: {
    name?: string;
    description?: string;
    purpose?: string;
    members?: TeamMember[];
    routes?: Record<string, RoleRoute>;
  },
): Team | undefined {
  const prev = getTeam(teamId);
  if (!prev) return undefined;
  getDb()
    .prepare(
      `UPDATE teams SET name = @name, description = @description, purpose = @purpose,
        members = @members, routes = @routes, updated_at = @now
       WHERE team_id = @teamId`,
    )
    .run({
      teamId,
      name: patch.name ?? prev.name,
      description: patch.description ?? prev.description ?? '',
      purpose: patch.purpose ?? prev.purpose ?? 'general',
      members: JSON.stringify(patch.members ?? prev.members),
      routes: JSON.stringify(patch.routes ?? prev.routes),
      now: Date.now(),
    });
  return getTeam(teamId);
}

/** 删除团队 */
export function deleteTeam(teamId: string): void {
  getDb().prepare(`DELETE FROM teams WHERE team_id = ?`).run(teamId);
}
