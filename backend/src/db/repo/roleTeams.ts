import { getDb } from '../database.js';
import type {
  AgentType,
  RoleTeam,
  SubRole,
  SubRoleOperation,
  SubRolePersona,
  SwarmPurpose,
} from '@agentfleet/shared';

/**
 * 蜂群角色团队（role_teams / sub_roles）CRUD。
 *
 * - role_teams.sub_roles 为有序子角色 slug JSON 数组（冗余），由 sub_roles 表派生；
 * - persona / operation / capabilities / required_capabilities 存 JSON，读取统一兜底；
 * - 时间戳 epoch 毫秒。
 */

/** role_teams 表行结构 */
export interface RoleTeamRow {
  role_team_id: string;
  name: string;
  slug: string;
  description: string;
  purpose: string;
  sub_roles: string;
  leader_slug: string | null;
  version: number;
  is_preset: number;
  created_at: number;
  updated_at: number;
}

/** sub_roles 表行结构 */
export interface SubRoleRow {
  sub_role_id: string;
  role_team_id: string;
  slug: string;
  name: string;
  description: string;
  capabilities: string;
  persona: string;
  operation: string;
  preferred_agent_type: string | null;
  required_capabilities: string;
  position: number;
}

/** 安全解析 JSON 数组 */
function parseArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 安全解析 persona（补齐缺省字段） */
function parsePersona(raw: string | null | undefined): SubRolePersona {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    obj = {};
  }
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    identity: str(obj.identity),
    communication: str(obj.communication),
    rules: arr(obj.rules),
    style: str(obj.style),
  };
}

/** 安全解析 operation（补齐缺省字段） */
function parseOperation(raw: string | null | undefined): SubRoleOperation {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    obj = {};
  }
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    mission: str(obj.mission),
    workflow: arr(obj.workflow),
    deliverables: arr(obj.deliverables),
  };
}

/** 行 → shared.RoleTeam */
export function rowToRoleTeam(row: RoleTeamRow): RoleTeam {
  return {
    roleTeamId: row.role_team_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    purpose: (row.purpose ?? 'general') as SwarmPurpose,
    subRoleIds: parseArray(row.sub_roles),
    leaderSlug: row.leader_slug ?? undefined,
    version: row.version ?? 1,
    isPreset: row.is_preset === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 行 → shared.SubRole */
export function rowToSubRole(row: SubRoleRow): SubRole {
  return {
    subRoleId: row.sub_role_id,
    roleTeamId: row.role_team_id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    capabilities: parseArray(row.capabilities),
    persona: parsePersona(row.persona),
    operation: parseOperation(row.operation),
    preferredAgentType: (row.preferred_agent_type as AgentType | null) ?? undefined,
    requiredCapabilities: parseArray(row.required_capabilities),
    position: row.position ?? 0,
  };
}

/** 查询团队（按 id） */
export function getRoleTeam(roleTeamId: string): RoleTeam | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM role_teams WHERE role_team_id = ?`)
    .get(roleTeamId) as RoleTeamRow | undefined;
  return row ? rowToRoleTeam(row) : undefined;
}

/** 查询团队（按全局唯一 slug） */
export function getRoleTeamBySlug(slug: string): RoleTeam | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM role_teams WHERE slug = ?`)
    .get(slug) as RoleTeamRow | undefined;
  return row ? rowToRoleTeam(row) : undefined;
}

/** 列表 */
export function listRoleTeams(limit = 500): RoleTeam[] {
  const rows = getDb()
    .prepare(`SELECT * FROM role_teams ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as RoleTeamRow[];
  return rows.map(rowToRoleTeam);
}

/** 团队子角色 slug 数组是否包含某 slug（用于冗余列维护） */
function subRoleIdsOf(roleTeamId: string): string[] {
  const rows = getDb()
    .prepare(`SELECT slug FROM sub_roles WHERE role_team_id = ? ORDER BY position ASC, slug ASC`)
    .all(roleTeamId) as Array<{ slug: string }>;
  return rows.map((r) => r.slug);
}

/** 子角色变更后回写 role_teams.sub_roles 冗余列 */
function syncSubRoleIds(roleTeamId: string): void {
  getDb()
    .prepare(`UPDATE role_teams SET sub_roles = ?, updated_at = ? WHERE role_team_id = ?`)
    .run(JSON.stringify(subRoleIdsOf(roleTeamId)), Date.now(), roleTeamId);
}

/** 子角色创建/更新输入（subRoleId 可缺省，由调用方生成） */
export interface SubRoleUpsertInput {
  subRoleId: string;
  slug: string;
  name: string;
  description?: string;
  capabilities?: string[];
  persona: SubRolePersona;
  operation: SubRoleOperation;
  preferredAgentType?: AgentType;
  requiredCapabilities?: string[];
  position?: number;
}

/** 创建团队（含子角色） */
export function createRoleTeam(input: {
  roleTeamId: string;
  name: string;
  slug: string;
  description?: string;
  purpose?: SwarmPurpose;
  isPreset?: boolean;
  subRoles?: SubRoleUpsertInput[];
}): RoleTeam {
  const now = Date.now();
  const subRoles = input.subRoles ?? [];
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO role_teams
        (role_team_id, name, slug, description, purpose, sub_roles, version, is_preset, created_at, updated_at)
       VALUES (@roleTeamId, @name, @slug, @description, @purpose, @subRoles, 1, @isPreset, @now, @now)`,
    ).run({
      roleTeamId: input.roleTeamId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? '',
      purpose: input.purpose ?? 'general',
      subRoles: JSON.stringify(subRoles.map((s) => s.slug)),
      isPreset: input.isPreset ? 1 : 0,
      now,
    });
    insertSubRolesTx(input.roleTeamId, subRoles);
  });
  tx();
  return getRoleTeam(input.roleTeamId) as RoleTeam;
}

/** 事务内批量插入子角色 */
function insertSubRolesTx(roleTeamId: string, subRoles: SubRoleUpsertInput[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO sub_roles
      (sub_role_id, role_team_id, slug, name, description, capabilities, persona, operation,
       preferred_agent_type, required_capabilities, position)
     VALUES (@subRoleId, @roleTeamId, @slug, @name, @description, @capabilities, @persona, @operation,
       @preferredAgentType, @requiredCapabilities, @position)`,
  );
  for (const [i, s] of subRoles.entries()) {
    stmt.run({
      subRoleId: s.subRoleId,
      roleTeamId,
      slug: s.slug,
      name: s.name,
      description: s.description ?? '',
      capabilities: JSON.stringify(s.capabilities ?? []),
      persona: JSON.stringify(s.persona),
      operation: JSON.stringify(s.operation),
      preferredAgentType: s.preferredAgentType ?? null,
      requiredCapabilities: JSON.stringify(s.requiredCapabilities ?? []),
      position: s.position ?? i,
    });
  }
}

/** 更新团队基础字段（不含子角色） */
export function updateRoleTeam(
  roleTeamId: string,
  patch: { name?: string; slug?: string; description?: string; purpose?: SwarmPurpose },
): RoleTeam | undefined {
  const prev = getRoleTeam(roleTeamId);
  if (!prev) return undefined;
  getDb()
    .prepare(
      `UPDATE role_teams SET name = @name, slug = @slug, description = @description, purpose = @purpose, updated_at = @now
       WHERE role_team_id = @roleTeamId`,
    )
    .run({
      roleTeamId,
      name: patch.name ?? prev.name,
      slug: patch.slug ?? prev.slug,
      description: patch.description ?? prev.description ?? '',
      purpose: patch.purpose ?? prev.purpose ?? 'general',
      now: Date.now(),
    });
  return getRoleTeam(roleTeamId);
}

/** 设置/清除团队 Leader 子角色（P2-4：slug=null 清除） */
export function setLeaderSlug(roleTeamId: string, slug: string | null): RoleTeam | undefined {
  getDb()
    .prepare(`UPDATE role_teams SET leader_slug = ?, updated_at = ? WHERE role_team_id = ?`)
    .run(slug, Date.now(), roleTeamId);
  return getRoleTeam(roleTeamId);
}

/** 删除团队（含其全部子角色） */
export function deleteRoleTeam(roleTeamId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM sub_roles WHERE role_team_id = ?`).run(roleTeamId);
    db.prepare(`DELETE FROM role_teams WHERE role_team_id = ?`).run(roleTeamId);
  });
  tx();
}

/** 查询子角色（按 slug） */
export function getSubRole(roleTeamId: string, slug: string): SubRole | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM sub_roles WHERE role_team_id = ? AND slug = ?`)
    .get(roleTeamId, slug) as SubRoleRow | undefined;
  return row ? rowToSubRole(row) : undefined;
}

/** 查询子角色（按 id） */
export function getSubRoleById(subRoleId: string): SubRole | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM sub_roles WHERE sub_role_id = ?`)
    .get(subRoleId) as SubRoleRow | undefined;
  return row ? rowToSubRole(row) : undefined;
}

/** 列出团队全部子角色（按 position 升序） */
export function listSubRoles(roleTeamId: string): SubRole[] {
  const rows = getDb()
    .prepare(`SELECT * FROM sub_roles WHERE role_team_id = ? ORDER BY position ASC, slug ASC`)
    .all(roleTeamId) as SubRoleRow[];
  return rows.map(rowToSubRole);
}

/** 新增或更新子角色（按 (role_team_id, slug) 幂等） */
export function upsertSubRole(roleTeamId: string, input: SubRoleUpsertInput): SubRole {
  const existing = getSubRole(roleTeamId, input.slug);
  const db = getDb();
  if (existing) {
    db.prepare(
      `UPDATE sub_roles SET
         name = @name, description = @description, capabilities = @capabilities,
         persona = @persona, operation = @operation, preferred_agent_type = @preferredAgentType,
         required_capabilities = @requiredCapabilities, position = @position
       WHERE sub_role_id = @subRoleId`,
    ).run({
      subRoleId: existing.subRoleId,
      name: input.name,
      description: input.description ?? existing.description ?? '',
      capabilities: JSON.stringify(input.capabilities ?? existing.capabilities),
      persona: JSON.stringify(input.persona ?? existing.persona),
      operation: JSON.stringify(input.operation ?? existing.operation),
      preferredAgentType: input.preferredAgentType ?? existing.preferredAgentType ?? null,
      requiredCapabilities: JSON.stringify(input.requiredCapabilities ?? existing.requiredCapabilities),
      position: input.position ?? existing.position ?? 0,
    });
  } else {
    const position = input.position ?? listSubRoles(roleTeamId).length;
    db.prepare(
      `INSERT INTO sub_roles
        (sub_role_id, role_team_id, slug, name, description, capabilities, persona, operation,
         preferred_agent_type, required_capabilities, position)
       VALUES (@subRoleId, @roleTeamId, @slug, @name, @description, @capabilities, @persona, @operation,
         @preferredAgentType, @requiredCapabilities, @position)`,
    ).run({
      subRoleId: input.subRoleId,
      roleTeamId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? '',
      capabilities: JSON.stringify(input.capabilities ?? []),
      persona: JSON.stringify(input.persona),
      operation: JSON.stringify(input.operation),
      preferredAgentType: input.preferredAgentType ?? null,
      requiredCapabilities: JSON.stringify(input.requiredCapabilities ?? []),
      position,
    });
  }
  syncSubRoleIds(roleTeamId);
  return getSubRole(roleTeamId, input.slug) as SubRole;
}

/** 删除子角色 */
export function deleteSubRole(roleTeamId: string, slug: string): void {
  getDb()
    .prepare(`DELETE FROM sub_roles WHERE role_team_id = ? AND slug = ?`)
    .run(roleTeamId, slug);
  syncSubRoleIds(roleTeamId);
}
