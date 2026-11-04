import type {
  AgentType,
  RoleTeam,
  SubRole,
  SubRoleOperation,
  SubRolePersona,
  SwarmPurpose,
} from '@agentfleet/shared';
import { randomId } from '../../security/auth.js';
import * as repo from '../../db/repo/roleTeams.js';
import {
  getDevice,
  getDeviceRoleTeam,
  getSubRoleBindings,
  listDeviceRoleTeams,
  listDevicesByRoleTeam,
  setDeviceRoleTeam,
  setDeviceRoleTeams,
  setSubRoleBinding,
  setSubRoleBindings,
} from '../../db/repo/devices.js';
import { SWARM_PRESETS, type SwarmPreset } from './presets.js';

/**
 * 蜂群角色团队服务：RoleTeam/SubRole CRUD + 设备软绑定 + 预设播种（幂等）。
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** 子角色创建/更新输入（subRoleId 由服务生成） */
export interface SubRoleInput {
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

export interface RoleTeamCreateInput {
  name: string;
  slug?: string;
  description?: string;
  purpose?: SwarmPurpose;
  subRoles?: SubRoleInput[];
}

export interface RoleTeamUpdateInput {
  name?: string;
  slug?: string;
  description?: string;
  purpose?: SwarmPurpose;
}

/** 设备 ↔ 蜂群角色团队绑定视图 */
export interface SwarmDeviceBinding {
  deviceId: string;
  roleTeamId: string;
  roleTeamName: string;
  purpose?: SwarmPurpose;
}

/** 名称 → slug（小写、非 [a-z0-9] 转 -、去首尾与重复 -） */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** 校验 slug 格式（[a-z0-9-]，不能以 - 开头） */
export function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error('invalid_slug');
}

/** 校验团队 slug 全局唯一（排除自身） */
function assertSlugUnique(slug: string, excludeRoleTeamId?: string): void {
  const existing = repo.getRoleTeamBySlug(slug);
  if (existing && existing.roleTeamId !== excludeRoleTeamId) throw new Error('slug_conflict');
}

/** 列表 */
export function list(): RoleTeam[] {
  return repo.listRoleTeams();
}

/** 详情（按 id） */
export function get(roleTeamId: string): RoleTeam | undefined {
  return repo.getRoleTeam(roleTeamId);
}

/** 详情（按 slug） */
export function getBySlug(slug: string): RoleTeam | undefined {
  return repo.getRoleTeamBySlug(slug);
}

/** 团队 + 子角色组合视图（供 REST 详情使用） */
export function detail(roleTeamId: string): (RoleTeam & { subRoles: SubRole[] }) | undefined {
  const team = repo.getRoleTeam(roleTeamId);
  if (!team) return undefined;
  return { ...team, subRoles: listSubRoles(roleTeamId) };
}

/** 创建团队（含可选子角色） */
export function create(input: RoleTeamCreateInput): RoleTeam {
  if (!input.name || typeof input.name !== 'string') throw new Error('name_required');
  const slug = input.slug ? input.slug.trim() : slugify(input.name);
  assertSlug(slug);
  assertSlugUnique(slug);

  // 子角色 slug 与单条 upsert 口径一致：格式校验 + 团队内查重
  const seen = new Set<string>();
  for (const s of input.subRoles ?? []) {
    assertSlug(s.slug);
    if (seen.has(s.slug)) throw new Error('duplicate_sub_role_slug');
    seen.add(s.slug);
  }

  const subRoles: repo.SubRoleUpsertInput[] = (input.subRoles ?? []).map((s, i) =>
    toUpsertInput(s, i),
  );
  return repo.createRoleTeam({
    roleTeamId: randomId('rteam'),
    name: input.name,
    slug,
    description: input.description,
    purpose: input.purpose,
    isPreset: false,
    subRoles,
  });
}

/** 更新团队基础字段 */
export function update(roleTeamId: string, patch: RoleTeamUpdateInput): RoleTeam | undefined {
  const prev = repo.getRoleTeam(roleTeamId);
  if (!prev) return undefined;
  const slug = patch.slug ? patch.slug.trim() : prev.slug;
  assertSlug(slug);
  assertSlugUnique(slug, roleTeamId);
  return repo.updateRoleTeam(roleTeamId, {
    name: patch.name,
    slug,
    description: patch.description,
    purpose: patch.purpose,
  });
}

/** 设置/清除团队 Leader 子角色（P2-4：slug=null 清除） */
export function setLeader(roleTeamId: string, slug: string | null): RoleTeam | undefined {
  const team = repo.getRoleTeam(roleTeamId);
  if (!team) return undefined;
  if (slug && !repo.getSubRole(roleTeamId, slug)) throw new Error('sub_role_not_found');
  return repo.setLeaderSlug(roleTeamId, slug);
}

/** 删除团队（先清空子角色软绑定，再解绑设备） */
export function remove(roleTeamId: string): void {
  const deviceIds = listDevicesByRoleTeam(roleTeamId);
  for (const deviceId of deviceIds) {
    // 团队生命周期结束，其子角色软绑定随之失效（避免幽灵绑定）
    setSubRoleBindings(deviceId, {});
  }
  setDeviceRoleTeams(deviceIds, null);
  repo.deleteRoleTeam(roleTeamId);
}

/** 列出团队子角色 */
export function listSubRoles(roleTeamId: string): SubRole[] {
  return repo.listSubRoles(roleTeamId);
}

/** 新增/更新子角色 */
export function upsertSubRole(roleTeamId: string, input: SubRoleInput): SubRole {
  if (!repo.getRoleTeam(roleTeamId)) throw new Error('team_not_found');
  if (!input.name || typeof input.name !== 'string') throw new Error('sub_role_name_required');
  assertSlug(input.slug);
  const existing = repo.getSubRole(roleTeamId, input.slug);
  return repo.upsertSubRole(roleTeamId, toUpsertInput(input, input.position ?? existing?.position));
}

/** 删除子角色 */
export function removeSubRole(roleTeamId: string, slug: string): void {
  repo.deleteSubRole(roleTeamId, slug);
}

/** 设备绑定团队 */
export function bindDevice(roleTeamId: string, deviceId: string): boolean {
  if (!repo.getRoleTeam(roleTeamId)) throw new Error('team_not_found');
  if (!getDevice(deviceId)) throw new Error('device_not_found');
  return setDeviceRoleTeam(deviceId, roleTeamId);
}

/** 批量绑定设备到团队 */
export function bindDevices(roleTeamId: string, deviceIds: string[]): { changed: number; missing: string[] } {
  if (!repo.getRoleTeam(roleTeamId)) throw new Error('team_not_found');
  const missing = deviceIds.filter((id) => !getDevice(id));
  const changed = setDeviceRoleTeams(
    deviceIds.filter((id) => !missing.includes(id)),
    roleTeamId,
  );
  return { changed, missing };
}

/** 解绑设备（可指定团队避免误删） */
export function unbindDevice(deviceId: string, roleTeamId?: string): boolean {
  if (!getDevice(deviceId)) throw new Error('device_not_found');
  if (roleTeamId && getDeviceRoleTeam(deviceId) !== roleTeamId) return false;
  return setDeviceRoleTeam(deviceId, null);
}

/** 团队绑定的设备 id 列表 */
export function teamDeviceIds(roleTeamId: string): string[] {
  if (!repo.getRoleTeam(roleTeamId)) return [];
  return listDevicesByRoleTeam(roleTeamId);
}

/** 设备 → 团队绑定视图（全量） */
export function listBindings(): SwarmDeviceBinding[] {
  const map = listDeviceRoleTeams();
  const teams = new Map(list().map((t) => [t.roleTeamId, t]));
  const out: SwarmDeviceBinding[] = [];
  for (const [deviceId, roleTeamId] of map) {
    const team = teams.get(roleTeamId);
    if (!team) continue;
    out.push({ deviceId, roleTeamId, roleTeamName: team.name, purpose: team.purpose });
  }
  return out;
}

/** 读取设备软绑定（{子角色 slug: AgentType}） */
export function deviceSubRoleBindings(deviceId: string): Record<string, AgentType> {
  return getSubRoleBindings(deviceId);
}

/** 设置单个子角色软绑定 */
export function setDeviceSubRoleBinding(
  deviceId: string,
  slug: string,
  agentType: AgentType | null,
): Record<string, AgentType> {
  if (!getDevice(deviceId)) throw new Error('device_not_found');
  return setSubRoleBinding(deviceId, slug, agentType);
}

/** 整体覆盖设备软绑定 */
export function setDeviceSubRoleBindings(
  deviceId: string,
  bindings: Record<string, AgentType>,
): boolean {
  if (!getDevice(deviceId)) throw new Error('device_not_found');
  return setSubRoleBindings(deviceId, bindings);
}

/** 子角色输入 → repo 输入（生成 subRoleId） */
function toUpsertInput(input: SubRoleInput, fallbackPosition?: number): repo.SubRoleUpsertInput {
  return {
    subRoleId: randomId('sr'),
    slug: input.slug,
    name: input.name,
    description: input.description,
    capabilities: input.capabilities,
    persona: input.persona,
    operation: input.operation,
    preferredAgentType: input.preferredAgentType,
    requiredCapabilities: input.requiredCapabilities,
    position: input.position ?? fallbackPosition ?? 0,
  };
}

/** 预设 → 团队（生成 id / position） */
function createFromPreset(preset: SwarmPreset): RoleTeam {
  const subRoles: repo.SubRoleUpsertInput[] = preset.subRoles.map((s, i) => ({
    subRoleId: randomId('sr'),
    slug: s.slug,
    name: s.name,
    description: s.description,
    capabilities: s.capabilities,
    persona: s.persona,
    operation: s.operation,
    preferredAgentType: s.preferredAgentType,
    requiredCapabilities: s.requiredCapabilities,
    position: i,
  }));
  return repo.createRoleTeam({
    roleTeamId: randomId('rteam'),
    name: preset.name,
    slug: preset.slug,
    description: preset.description,
    purpose: preset.purpose,
    isPreset: true,
    subRoles,
  });
}

/** 播种预设角色团队（按 slug 查重幂等，不覆盖用户编辑） */
export function seedPresets(): number {
  let seeded = 0;
  for (const preset of SWARM_PRESETS) {
    if (repo.getRoleTeamBySlug(preset.slug)) continue;
    createFromPreset(preset);
    seeded += 1;
  }
  return seeded;
}
