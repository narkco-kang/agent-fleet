import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { setAgentActivated, upsertAgents } from '../src/db/repo/agents.js';
import { getDevice, upsertDevice } from '../src/db/repo/devices.js';
import { getTask } from '../src/db/repo/tasks.js';
import { setRelayForward } from '../src/transport/wsServer.js';
import { enqueueTask } from '../src/services/scheduler.js';
import { buildSystemPrompt } from '../src/services/swarm/personaBuilder.js';
import { SWARM_PRESETS } from '../src/services/swarm/presets.js';
import * as roleTeamRepo from '../src/db/repo/roleTeams.js';
import * as swarmService from '../src/services/swarm/roleTeamService.js';
import { swarmRouter } from '../src/services/swarm/swarmRouter.js';
import { registerSwarmRoutes } from '../src/routes/swarm.js';
import { registerDeviceRoutes } from '../src/routes/devices.js';
import type { AgentType, Envelope, SubRole, SubRoleInput, TaskSubmit } from '@agentfleet/shared';

/**
 * 蜂群角色团队（swarm）功能验收测试。
 *
 * 覆盖：数据地基 / 预设播种幂等 / roleTeams CRUD / 设备软绑定 /
 *       swarmRouter 三级软绑定 / personaBuilder / 调度集成 / REST 端点。
 * 迁移（老库补列）见 swarm-migration.test.ts；设备端 prompt 合并见 swarm-device-merge.test.ts。
 */

let tmpDir: string;

/** 老库迁移后的新列在 schema.sql 之外，故用 PRAGMA 校验 */
function columnsOf(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

/** 注册在线设备（relay 直连语义）+ 落库 devices 行 */
function registerDevice(deviceId: string, online = true): void {
  if (online) deviceRegistry.register(deviceId, deviceId, 'relay');
  upsertDevice({
    deviceId,
    name: deviceId,
    hostname: deviceId,
    os: { platform: 'darwin', arch: 'arm64', release: '25.0' },
    version: '0.1.0',
  });
}

/** 设备上登记一个 agent（默认已激活） */
function seedAgent(
  deviceId: string,
  agentType: AgentType,
  opts: { capabilities?: string[]; activated?: boolean; status?: 'available' | 'error' } = {},
): void {
  upsertAgents(deviceId, [
    {
      agentType,
      displayName: agentType,
      version: '1.0.0',
      executable: agentType,
      status: opts.status ?? 'available',
      detectMethod: 'which',
      capabilities: opts.capabilities ?? [],
      maxConcurrency: 1,
    },
  ]);
  if (opts.activated ?? true) setAgentActivated(deviceId, agentType, true);
}

const PERSONA = {
  identity: 'IDENTITY_TEXT_工程师身份',
  communication: 'COMMUNICATION_TEXT_汇报方式',
  rules: ['RULE_ALPHA', 'RULE_BETA'],
  style: 'STYLE_TEXT_务实',
};

const OPERATION = {
  mission: 'MISSION_TEXT_交付可靠代码',
  workflow: ['WORKFLOW_ONE', 'WORKFLOW_TWO'],
  deliverables: ['DELIVERABLE_ONE'],
};

function subRoleInput(slug: string, over: Partial<SubRoleInput> = {}): SubRoleInput {
  return {
    slug,
    name: `${slug}-name`,
    description: `${slug}-desc`,
    capabilities: [`${slug}-cap`],
    persona: { ...PERSONA },
    operation: { ...OPERATION },
    requiredCapabilities: ['coding'],
    position: 0,
    ...over,
  };
}

/** 建一个含 1~N 个子角色的团队，返回团队 id */
function createTeam(slug: string, subRoles: SubRoleInput[]): string {
  return swarmService.create({ name: `${slug}-team`, slug, subRoles }).roleTeamId;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-swarm-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const e of Array.from(deviceRegistry.all())) deviceRegistry.remove(e.deviceId);
  getDb().exec(
    `DELETE FROM sub_roles;
     DELETE FROM role_teams;
     DELETE FROM agents;
     DELETE FROM devices;
     DELETE FROM tasks;
     DELETE FROM sessions;`,
  );
});

// ============================================================
// A. 数据地基
// ============================================================
describe('A. 数据地基（表 / 列 / 索引）', () => {
  it('role_teams、sub_roles 表存在', () => {
    const names = (
      getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['role_teams', 'sub_roles']));
  });

  it('role_teams 关键列齐全（slug 唯一 / sub_roles 冗余 / is_preset）', () => {
    expect(columnsOf('role_teams')).toEqual(
      expect.arrayContaining([
        'role_team_id',
        'name',
        'slug',
        'description',
        'purpose',
        'sub_roles',
        'version',
        'is_preset',
        'created_at',
        'updated_at',
      ]),
    );
    expect(columnsOf('sub_roles')).toEqual(
      expect.arrayContaining([
        'sub_role_id',
        'role_team_id',
        'slug',
        'name',
        'capabilities',
        'persona',
        'operation',
        'preferred_agent_type',
        'required_capabilities',
        'position',
      ]),
    );
  });

  it('devices 补齐 role_team_id / sub_role_bindings 列，默认 {}', () => {
    expect(columnsOf('devices')).toEqual(
      expect.arrayContaining(['role_team_id', 'sub_role_bindings']),
    );
    registerDevice('dev-schema');
    const row = getDevice('dev-schema');
    expect(row?.role_team_id).toBeNull();
    expect(row?.sub_role_bindings).toBe('{}');
  });

  it('tasks 补齐 target_role_team_id / target_sub_role 列', () => {
    expect(columnsOf('tasks')).toEqual(
      expect.arrayContaining(['target_role_team_id', 'target_sub_role']),
    );
  });

  it('蜂群相关索引已建立', () => {
    const idx = (
      getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(idx).toEqual(
      expect.arrayContaining(['idx_role_teams_slug', 'idx_sub_roles_team', 'idx_devices_role_team']),
    );
  });
});

// ============================================================
// B. seedPresets 幂等
// ============================================================
describe('B. seedPresets 幂等', () => {
  it('首次播种：3 个预设团队 / 12 个子角色 / isPreset=true', () => {
    const seeded = swarmService.seedPresets();
    expect(seeded).toBe(SWARM_PRESETS.length);
    expect(SWARM_PRESETS).toHaveLength(3);

    const teams = swarmService.list();
    expect(teams).toHaveLength(3);
    expect(teams.every((t) => t.isPreset)).toBe(true);
    expect(teams.map((t) => t.slug).sort()).toEqual(
      ['content-creation', 'security-audit', 'software-development'].sort(),
    );

    const subRoleCount = teams.reduce((n, t) => n + swarmService.listSubRoles(t.roleTeamId).length, 0);
    expect(subRoleCount).toBe(12);
  });

  it('连跑两次不重复：第二次返回 0，条数不变', () => {
    expect(swarmService.seedPresets()).toBe(3);
    expect(swarmService.seedPresets()).toBe(0);

    expect(swarmService.list()).toHaveLength(3);
    const subRoleCount = swarmService
      .list()
      .reduce((n, t) => n + swarmService.listSubRoles(t.roleTeamId).length, 0);
    expect(subRoleCount).toBe(12);
  });

  it('用户改过的预设不被覆盖（名称保留）', () => {
    swarmService.seedPresets();
    const team = swarmService.getBySlug('software-development');
    expect(team).toBeDefined();
    swarmService.update(team!.roleTeamId, { name: '我改过的团队名' });

    expect(swarmService.seedPresets()).toBe(0);
    expect(swarmService.get(team!.roleTeamId)?.name).toBe('我改过的团队名');
    expect(swarmService.get(team!.roleTeamId)?.isPreset).toBe(true);
  });

  it('预设子角色 slug 团队内唯一且 position 从 0 递增', () => {
    swarmService.seedPresets();
    for (const team of swarmService.list()) {
      const subs = swarmService.listSubRoles(team.roleTeamId);
      expect(subs).toHaveLength(4);
      expect(new Set(subs.map((s) => s.slug)).size).toBe(4);
      expect(subs.map((s) => s.position)).toEqual([0, 1, 2, 3]);
      // role_teams.sub_roles 冗余列与事实源一致
      expect(team.subRoleIds).toEqual(subs.map((s) => s.slug));
    }
  });
});

// ============================================================
// C. roleTeams repo CRUD + JSON 往返
// ============================================================
describe('C. roleTeams repo CRUD', () => {
  it('create / get / getBySlug / detail 全链路', () => {
    const teamId = createTeam('crud-team', [subRoleInput('alpha'), subRoleInput('beta', { position: 1 })]);
    const byId = roleTeamRepo.getRoleTeam(teamId);
    expect(byId?.slug).toBe('crud-team');
    expect(byId?.isPreset).toBe(false);
    expect(roleTeamRepo.getRoleTeamBySlug('crud-team')?.roleTeamId).toBe(teamId);

    const detail = swarmService.detail(teamId);
    expect(detail?.subRoles.map((s) => s.slug)).toEqual(['alpha', 'beta']);
    expect(detail?.subRoleIds).toEqual(['alpha', 'beta']);

    expect(roleTeamRepo.listRoleTeams().map((t) => t.roleTeamId)).toContain(teamId);
  });

  it('update 基础字段；slug 冲突抛 slug_conflict；非法 slug 抛 invalid_slug', () => {
    const a = createTeam('team-a', []);
    createTeam('team-b', []);

    const updated = swarmService.update(a, { name: 'A2', purpose: 'content', description: 'd2' });
    expect(updated).toMatchObject({ name: 'A2', purpose: 'content', description: 'd2' });

    expect(() => swarmService.update(a, { slug: 'team-b' })).toThrow('slug_conflict');
    expect(() => swarmService.update(a, { slug: 'Bad Slug!' })).toThrow('invalid_slug');
    // 未知团队 → undefined（不抛错）
    expect(swarmService.update('no-such-team', { name: 'x' })).toBeUndefined();
  });

  it('delete 级联删除子角色并解绑设备', () => {
    const teamId = createTeam('del-team', [subRoleInput('gamma')]);
    registerDevice('dev-del');
    swarmService.bindDevice(teamId, 'dev-del');
    expect(getDevice('dev-del')?.role_team_id).toBe(teamId);

    swarmService.remove(teamId);
    expect(roleTeamRepo.getRoleTeam(teamId)).toBeUndefined();
    expect(roleTeamRepo.listSubRoles(teamId)).toHaveLength(0);
    expect(getDevice('dev-del')?.role_team_id).toBeNull();
  });

  it('delete 同时清空设备子角色软绑定（避免幽灵绑定）', () => {
    const teamId = createTeam('del-ghost-team', [subRoleInput('qa')]);
    registerDevice('dev-ghost');
    swarmService.bindDevice(teamId, 'dev-ghost');
    swarmService.setDeviceSubRoleBinding('dev-ghost', 'qa', 'grok');
    expect(swarmService.deviceSubRoleBindings('dev-ghost')).toEqual({ qa: 'grok' });

    swarmService.remove(teamId);
    expect(getDevice('dev-ghost')?.role_team_id).toBeNull();
    expect(swarmService.deviceSubRoleBindings('dev-ghost')).toEqual({});
  });

  it('JSON 字段序列化往返一致（persona/operation/capabilities/requiredCapabilities）', () => {
    const teamId = createTeam('json-team', [
      subRoleInput('roundtrip', {
        capabilities: ['cap-1', 'cap-2'],
        requiredCapabilities: ['reasoning', 'shell'],
        preferredAgentType: 'claude',
      }),
    ]);
    const sub = roleTeamRepo.getSubRole(teamId, 'roundtrip') as SubRole;
    expect(sub.persona).toEqual(PERSONA);
    expect(sub.operation).toEqual(OPERATION);
    expect(sub.capabilities).toEqual(['cap-1', 'cap-2']);
    expect(sub.requiredCapabilities).toEqual(['reasoning', 'shell']);
    expect(sub.preferredAgentType).toBe('claude');
    expect(sub.description).toBe('roundtrip-desc');
  });

  it('脏 / 空 JSON 兜底：不抛错且字段补齐缺省值', () => {
    const teamId = createTeam('dirty-team', []);
    getDb()
      .prepare(
        `INSERT INTO sub_roles
          (sub_role_id, role_team_id, slug, name, description, capabilities, persona, operation,
           preferred_agent_type, required_capabilities, position)
         VALUES ('sr-dirty', ?, 'dirty', '脏数据', '', 'not-json', 'not-json', '', NULL, '', 0)`,
      )
      .run(teamId);

    const sub = roleTeamRepo.getSubRole(teamId, 'dirty') as SubRole;
    expect(sub.capabilities).toEqual([]);
    expect(sub.requiredCapabilities).toEqual([]);
    expect(sub.persona).toEqual({ identity: '', communication: '', rules: [], style: '' });
    expect(sub.operation).toEqual({ mission: '', workflow: [], deliverables: [] });
    expect(sub.preferredAgentType).toBeUndefined();
    // 脏数据下 persona 构建也不抛错
    expect(() => buildSystemPrompt(sub)).not.toThrow();
  });

  it('upsertSubRole：同 slug 更新不新增（团队内幂等）', () => {
    const teamId = createTeam('upsert-team', [subRoleInput('one')]);
    const first = roleTeamRepo.getSubRole(teamId, 'one') as SubRole;

    const updated = swarmService.upsertSubRole(teamId, {
      ...subRoleInput('one'),
      name: '改名了',
      persona: { ...PERSONA, identity: 'NEW_IDENTITY' },
    });
    expect(updated.subRoleId).toBe(first.subRoleId); // 复用原 id
    expect(updated.name).toBe('改名了');
    expect(updated.persona.identity).toBe('NEW_IDENTITY');
    expect(roleTeamRepo.listSubRoles(teamId)).toHaveLength(1);
  });

  it('removeSubRole 后 role_teams.sub_roles 冗余列同步', () => {
    const teamId = createTeam('sync-team', [subRoleInput('x'), subRoleInput('y', { position: 1 })]);
    swarmService.removeSubRole(teamId, 'x');
    expect(roleTeamRepo.getRoleTeam(teamId)?.subRoleIds).toEqual(['y']);
  });

  it('slug 规范化与校验工具', () => {
    expect(swarmService.slugify('  Software Development  ')).toBe('software-development');
    expect(swarmService.slugify('安全审计团队')).toBe(''); // 非 ascii 全被替换
    expect(() => swarmService.assertSlug('-abc')).toThrow('invalid_slug');
    expect(() => swarmService.assertSlug('ABC')).toThrow('invalid_slug');
    expect(() => swarmService.assertSlug('abc-123')).not.toThrow();
  });

  it('create 缺少 name / 团队不存在时抛错', () => {
    expect(() => swarmService.create({ name: '' })).toThrow('name_required');
    expect(() => swarmService.upsertSubRole('no-such-team', subRoleInput('z'))).toThrow(
      'team_not_found',
    );
  });

  it('create 校验子角色 slug：非法 → invalid_slug，重复 → duplicate_sub_role_slug（非裸 SQL 错误）', () => {
    expect(() =>
      swarmService.create({ name: 'bad-child', slug: 'bad-child', subRoles: [subRoleInput('BAD SLUG')] }),
    ).toThrow('invalid_slug');
    expect(() =>
      swarmService.create({
        name: 'dup-child',
        slug: 'dup-child',
        subRoles: [subRoleInput('dup'), subRoleInput('dup', { position: 1 })],
      }),
    ).toThrow('duplicate_sub_role_slug');
    // 校验失败不落库（无脏数据）
    expect(roleTeamRepo.getRoleTeamBySlug('bad-child')).toBeUndefined();
    expect(roleTeamRepo.getRoleTeamBySlug('dup-child')).toBeUndefined();
  });
});

// ============================================================
// D. 设备绑定
// ============================================================
describe('D. 设备 ↔ 团队绑定', () => {
  it('bindDevice 写入 devices.role_team_id，listDevicesByRoleTeam 返回正确集合', () => {
    const teamId = createTeam('bind-team', []);
    const other = createTeam('other-team', []);
    registerDevice('dev-1');
    registerDevice('dev-2');
    registerDevice('dev-3');

    expect(swarmService.bindDevice(teamId, 'dev-1')).toBe(true);
    expect(swarmService.bindDevice(teamId, 'dev-2')).toBe(true);
    expect(swarmService.bindDevice(other, 'dev-3')).toBe(true);

    expect(getDevice('dev-1')?.role_team_id).toBe(teamId);
    expect(swarmService.teamDeviceIds(teamId).sort()).toEqual(['dev-1', 'dev-2']);
    expect(swarmService.teamDeviceIds(other)).toEqual(['dev-3']);
    expect(swarmService.teamDeviceIds('no-such-team')).toEqual([]);
  });

  it('软绑定 {slug: agentType} JSON 往返一致', () => {
    createTeam('b1', []);
    registerDevice('dev-b');
    const bindings: Record<string, AgentType> = { architect: 'claude', engineer: 'codex' };
    expect(swarmService.setDeviceSubRoleBindings('dev-b', bindings)).toBe(true);
    expect(swarmService.deviceSubRoleBindings('dev-b')).toEqual(bindings);
    // 落库为 JSON 字符串
    expect(getDevice('dev-b')?.sub_role_bindings).toBe(JSON.stringify(bindings));
  });

  it('setSubRoleBinding 单个增删', () => {
    registerDevice('dev-c');
    swarmService.setDeviceSubRoleBinding('dev-c', 'qa', 'grok');
    swarmService.setDeviceSubRoleBinding('dev-c', 'devops', 'dsh');
    expect(swarmService.deviceSubRoleBindings('dev-c')).toEqual({ qa: 'grok', devops: 'dsh' });

    const after = swarmService.setDeviceSubRoleBinding('dev-c', 'qa', null);
    expect(after).toEqual({ devops: 'dsh' });
    expect(swarmService.deviceSubRoleBindings('dev-c')).toEqual({ devops: 'dsh' });
  });

  it('unbindDevice 团队不匹配时返回 false；批量绑定上报缺失设备', () => {
    const teamId = createTeam('ub-team', []);
    const other = createTeam('ub-other', []);
    registerDevice('dev-u');

    swarmService.bindDevice(teamId, 'dev-u');
    expect(swarmService.unbindDevice('dev-u', other)).toBe(false);
    expect(getDevice('dev-u')?.role_team_id).toBe(teamId);
    expect(swarmService.unbindDevice('dev-u', teamId)).toBe(true);
    expect(getDevice('dev-u')?.role_team_id).toBeNull();

    const res = swarmService.bindDevices(teamId, ['dev-u', 'dev-missing']);
    expect(res.changed).toBe(1);
    expect(res.missing).toEqual(['dev-missing']);
  });

  it('bindDevice 未知团队 / 未知设备抛错；listBindings 视图正确', () => {
    const teamId = createTeam('view-team', []);
    registerDevice('dev-v');
    expect(() => swarmService.bindDevice('no-such-team', 'dev-v')).toThrow('team_not_found');
    expect(() => swarmService.bindDevice(teamId, 'no-such-device')).toThrow('device_not_found');

    swarmService.bindDevice(teamId, 'dev-v');
    expect(swarmService.listBindings()).toEqual([
      { deviceId: 'dev-v', roleTeamId: teamId, roleTeamName: 'view-team-team', purpose: 'general' },
    ]);
  });
});

// ============================================================
// E. swarmRouter 三级软绑定（核心）
// ============================================================
describe('E. swarmRouter 三级软绑定', () => {
  /** 设备 A：claude + codex（均激活）；子角色 preferred=claude，required=['coding'] */
  function setupSoftBindingTeam() {
    registerDevice('dev-a');
    seedAgent('dev-a', 'claude', { capabilities: ['coding', 'reasoning'] });
    seedAgent('dev-a', 'codex', { capabilities: ['coding', 'shell'] });
    const teamId = createTeam('soft-team', [
      subRoleInput('engineer', {
        preferredAgentType: 'claude',
        requiredCapabilities: ['coding'],
        position: 0,
      }),
      subRoleInput('ops', { preferredAgentType: 'dsh', requiredCapabilities: ['deploy'], position: 1 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-a');
    return teamId;
  }

  it('① 手动绑定命中 → source=manual，agentType 为手动指定值（覆盖 preferred）', () => {
    const teamId = setupSoftBindingTeam();
    swarmService.setDeviceSubRoleBinding('dev-a', 'engineer', 'codex');

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' });
    expect(d).not.toBeNull();
    expect(d?.source).toBe('manual');
    expect(d?.deviceId).toBe('dev-a');
    expect(d?.agentType).toBe('codex'); // 手动值，不是 preferred 的 claude
    expect(d?.subRoleSlug).toBe('engineer');
    expect(d?.roleTeamId).toBe(teamId);
    expect(d?.systemPrompt).toContain('IDENTITY_TEXT_工程师身份');
  });

  it('② 无手动绑定 → source=preferred，命中 preferred_agent_type', () => {
    const teamId = setupSoftBindingTeam();
    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' });
    expect(d?.source).toBe('preferred');
    expect(d?.agentType).toBe('claude');
    expect(d?.deviceId).toBe('dev-a');
  });

  it('③ 前两级未命中 → source=capability，按能力兜底匹配已激活 agent', () => {
    registerDevice('dev-cap');
    seedAgent('dev-cap', 'gemini', { capabilities: ['coding', 'reasoning'] });
    const teamId = createTeam('cap-team', [
      subRoleInput('dev', { preferredAgentType: 'dsh', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-cap');

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'dev' });
    expect(d?.source).toBe('capability');
    expect(d?.agentType).toBe('gemini');
    expect(d?.deviceId).toBe('dev-cap');
  });

  it('④ 全不匹配 → null（任务保持 queued）', () => {
    registerDevice('dev-none');
    seedAgent('dev-none', 'grok', { capabilities: ['chat'] });
    const teamId = createTeam('none-team', [
      subRoleInput('x', { preferredAgentType: 'dsh', requiredCapabilities: ['deploy'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-none');

    expect(swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'x' })).toBeNull();
  });

  it('离线设备不参与候选（只有离线设备时返回 null）', () => {
    const teamId = setupSoftBindingTeam();
    deviceRegistry.remove('dev-a'); // 离线
    expect(swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' })).toBeNull();
  });

  it('在线设备优先：离线设备手动绑定被跳过，取在线设备', () => {
    registerDevice('dev-offline');
    seedAgent('dev-offline', 'codex', { capabilities: ['coding'] });
    registerDevice('dev-online');
    seedAgent('dev-online', 'claude', { capabilities: ['coding'] });
    const teamId = createTeam('mix-team', [
      subRoleInput('engineer', { preferredAgentType: 'claude', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-offline');
    swarmService.bindDevice(teamId, 'dev-online');
    swarmService.setDeviceSubRoleBinding('dev-offline', 'engineer', 'codex');
    deviceRegistry.remove('dev-offline');

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' });
    expect(d?.deviceId).toBe('dev-online');
    expect(d?.source).toBe('preferred');
  });

  it('未绑定该团队的设备不参与候选', () => {
    const teamId = setupSoftBindingTeam();
    registerDevice('dev-outsider');
    seedAgent('dev-outsider', 'claude', { capabilities: ['coding', 'reasoning'] });
    // dev-outsider 未 bindDevice

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' });
    expect(d?.deviceId).toBe('dev-a');
  });

  it('未知团队 / 未知子角色 → null', () => {
    const teamId = setupSoftBindingTeam();
    expect(swarmRouter.resolve({ roleTeamId: 'no-such-team' })).toBeNull();
    expect(swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'no-such-role' })).toBeNull();
  });

  it('缺省 subRoleSlug → 取 position 最小的第一个子角色', () => {
    registerDevice('dev-first');
    seedAgent('dev-first', 'claude', { capabilities: ['coding'] });
    const teamId = createTeam('first-team', [
      subRoleInput('second', { position: 1, preferredAgentType: 'claude' }),
      subRoleInput('first', { position: 0, preferredAgentType: 'claude' }),
    ]);
    swarmService.bindDevice(teamId, 'dev-first');

    const d = swarmRouter.resolve({ roleTeamId: teamId });
    expect(d?.subRoleSlug).toBe('first');
  });

  it('能力兜底要求已激活；未激活 agent 不参与 capability 第 3 级', () => {
    registerDevice('dev-inactive');
    seedAgent('dev-inactive', 'gemini', { capabilities: ['coding'], activated: false });
    const teamId = createTeam('inactive-team', [
      subRoleInput('dev', { preferredAgentType: 'dsh', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-inactive');

    expect(swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'dev' })).toBeNull();
  });

  it('preferred 级要求已激活：未激活的偏好平台不命中，回落 capability', () => {
    registerDevice('dev-pref-inactive');
    seedAgent('dev-pref-inactive', 'claude', { capabilities: ['coding'], activated: false });
    seedAgent('dev-pref-inactive', 'codex', { capabilities: ['coding'] });
    const teamId = createTeam('pref-inactive-team', [
      subRoleInput('engineer', { preferredAgentType: 'claude', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-pref-inactive');

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' });
    expect(d?.source).toBe('capability');
    expect(d?.agentType).toBe('codex');
  });

  it('manual 级不校验激活：用户显式绑定的未激活平台仍为 manual 候选', () => {
    registerDevice('dev-manual-inactive');
    seedAgent('dev-manual-inactive', 'claude', { capabilities: ['coding'], activated: false });
    const teamId = createTeam('manual-inactive-team', [
      subRoleInput('engineer', { preferredAgentType: 'claude', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-manual-inactive');
    swarmService.setDeviceSubRoleBinding('dev-manual-inactive', 'engineer', 'claude');

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'engineer' });
    expect(d?.source).toBe('manual');
    expect(d?.agentType).toBe('claude');
  });

  it('status=error 的 agent 不参与任一级命中', () => {
    registerDevice('dev-err');
    seedAgent('dev-err', 'claude', { capabilities: ['coding'], status: 'error' });
    const teamId = createTeam('err-team', [
      subRoleInput('dev', { preferredAgentType: 'claude', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-err');

    expect(swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'dev' })).toBeNull();
  });

  it('requiredCapabilities 为空数组时 capability 级退化为「任一已激活 agent」', () => {
    registerDevice('dev-any');
    seedAgent('dev-any', 'kimi', { capabilities: [] });
    const teamId = createTeam('any-team', [subRoleInput('any', { requiredCapabilities: [], position: 0 })]);
    swarmService.bindDevice(teamId, 'dev-any');

    const d = swarmRouter.resolve({ roleTeamId: teamId, subRoleSlug: 'any' });
    expect(d?.source).toBe('capability');
    expect(d?.agentType).toBe('kimi');
  });

  it('预设团队可直接被解析（software-development/qa → grok 偏好）', () => {
    swarmService.seedPresets();
    const team = swarmService.getBySlug('software-development')!;
    registerDevice('dev-preset');
    seedAgent('dev-preset', 'grok', { capabilities: ['testing'] });
    swarmService.bindDevice(team.roleTeamId, 'dev-preset');

    const d = swarmRouter.resolve({ roleTeamId: team.roleTeamId, subRoleSlug: 'qa' });
    expect(d?.source).toBe('preferred');
    expect(d?.agentType).toBe('grok');
    expect(d?.systemPrompt).toContain('质量保障');
  });
});

// ============================================================
// F. personaBuilder.buildSystemPrompt
// ============================================================
describe('F. personaBuilder.buildSystemPrompt', () => {
  it('输出包含 identity / 沟通方式 / rules / mission / workflow / style', () => {
    const teamId = createTeam('pb-team', [subRoleInput('pb', { name: '测试角色' })]);
    const sub = roleTeamRepo.getSubRole(teamId, 'pb') as SubRole;
    const prompt = buildSystemPrompt(sub);

    expect(prompt).toContain('测试角色');
    expect(prompt).toContain('IDENTITY_TEXT_工程师身份');
    expect(prompt).toContain('COMMUNICATION_TEXT_汇报方式');
    expect(prompt).toContain('RULE_ALPHA');
    expect(prompt).toContain('RULE_BETA');
    expect(prompt).toContain('MISSION_TEXT_交付可靠代码');
    // 工作流带序号
    expect(prompt).toContain('1. WORKFLOW_ONE');
    expect(prompt).toContain('2. WORKFLOW_TWO');
    expect(prompt).toContain('STYLE_TEXT_务实');
    expect(prompt).not.toContain('undefined');
  });

  it('确定性：同一子角色两次构建输出完全一致', () => {
    const teamId = createTeam('pb2-team', [subRoleInput('pb2')]);
    const sub = roleTeamRepo.getSubRole(teamId, 'pb2') as SubRole;
    expect(buildSystemPrompt(sub)).toBe(buildSystemPrompt(sub));
  });

  it('空字段不产生 undefined / null 字样，也不产生空标题段落', () => {
    const teamId = createTeam('empty-team', []);
    getDb()
      .prepare(
        `INSERT INTO sub_roles
          (sub_role_id, role_team_id, slug, name, description, capabilities, persona, operation,
           preferred_agent_type, required_capabilities, position)
         VALUES ('sr-empty', ?, 'empty', '空角色', '', '[]', '{}', '{}', NULL, '[]', 0)`,
      )
      .run(teamId);
    const sub = roleTeamRepo.getSubRole(teamId, 'empty') as SubRole;

    const prompt = buildSystemPrompt(sub);
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('null');
    expect(prompt).toContain('空角色');
    expect(prompt).not.toContain('【身份】');
    expect(prompt).not.toContain('【工作流程】');
  });

  it('无子角色（undefined）时抛 TypeError 或返回空串 —— 记录边界行为', () => {
    // 契约：调用方必须传 SubRole；swarmRouter 已在 subRole 缺失时提前返回 null
    let result: string | undefined;
    try {
      result = buildSystemPrompt(undefined as unknown as SubRole);
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      result = '';
    }
    expect(result === '' || typeof result === 'string').toBe(true);
    // 真实路径：无子角色时 resolve 返回 null（不进入 persona 构建）
    expect(swarmRouter.resolve({ roleTeamId: 'no-such-team' })).toBeNull();
  });

  it('预设子角色 prompt 含关键块（身份/行为准则/任务使命/工作流程）', () => {
    swarmService.seedPresets();
    const team = swarmService.getBySlug('software-development')!;
    const architect = roleTeamRepo.getSubRole(team.roleTeamId, 'architect') as SubRole;
    const prompt = buildSystemPrompt(architect);
    for (const block of ['【身份】', '【行为准则】', '【任务使命】', '【工作流程】']) {
      expect(prompt).toContain(block);
    }
  });
});

// ============================================================
// G. 调度集成（target.mode='swarm' → 路由 + persona 下发）
// ============================================================
describe('G. 调度集成（swarm 任务派发）', () => {
  let sent: Array<{ deviceId: string; envelope: Envelope }>;

  beforeAll(() => {
    setRelayForward((deviceId, envelope) => {
      sent.push({ deviceId, envelope });
    });
  });

  beforeEach(() => {
    sent = [];
  });

  function submitSwarmTask(taskId: string, roleTeamId: string, subRole?: string): void {
    enqueueTask({
      taskId,
      sessionId: `sess-${taskId}`,
      origin: 'dashboard',
      originRef: 'qa-swarm',
      prompt: '请实现登录接口',
      targetMode: 'swarm',
      targetRoleTeamId: roleTeamId,
      targetSubRole: subRole,
    });
  }

  it('swarm 任务按手动绑定派发：deviceId / agentType 正确，systemPrompt 注入 persona', () => {
    registerDevice('dev-dispatch');
    seedAgent('dev-dispatch', 'codex', { capabilities: ['coding'] });
    const teamId = createTeam('dispatch-team', [
      subRoleInput('engineer', { preferredAgentType: 'claude', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-dispatch');
    swarmService.setDeviceSubRoleBinding('dev-dispatch', 'engineer', 'codex');

    submitSwarmTask('task-swarm-1', teamId, 'engineer');

    const row = getTask('task-swarm-1');
    expect(row?.target_mode).toBe('swarm');
    expect(row?.target_role_team_id).toBe(teamId);
    expect(row?.target_sub_role).toBe('engineer');
    expect(row?.target_device_id).toBe('dev-dispatch');
    expect(row?.target_agent_type).toBe('codex');
    expect(row?.status).toBe('running');

    const dispatched = sent.find((s) => s.deviceId === 'dev-dispatch');
    expect(dispatched).toBeDefined();
    const payload = dispatched!.envelope.payload as TaskSubmit;
    expect(payload.taskId).toBe('task-swarm-1');
    expect(payload.target.mode).toBe('swarm');
    expect(payload.target.agentType).toBe('codex');
    expect(payload.systemPrompt).toBeTruthy();
    expect(payload.systemPrompt).toContain('IDENTITY_TEXT_工程师身份');
    expect(payload.systemPrompt).toContain('MISSION_TEXT_交付可靠代码');
    // 原始 prompt 不被改写（合并发生在设备侧）
    expect(payload.prompt).toBe('请实现登录接口');
  });

  it('无匹配设备 → 任务保持 queued 且不下发', () => {
    const teamId = createTeam('queued-team', [
      subRoleInput('engineer', { preferredAgentType: 'dsh', requiredCapabilities: ['deploy'], position: 0 }),
    ]);
    submitSwarmTask('task-swarm-queued', teamId, 'engineer');

    expect(getTask('task-swarm-queued')?.status).toBe('queued');
    expect(getTask('task-swarm-queued')?.target_device_id).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('未指定 subRole → 使用第一个子角色并注入其 persona', () => {
    registerDevice('dev-first-role');
    seedAgent('dev-first-role', 'claude', { capabilities: ['coding'] });
    const teamId = createTeam('first-role-team', [
      subRoleInput('alpha', { position: 0, preferredAgentType: 'claude', persona: { ...PERSONA, identity: 'ALPHA_ID' } }),
      subRoleInput('beta', { position: 1, preferredAgentType: 'claude', persona: { ...PERSONA, identity: 'BETA_ID' } }),
    ]);
    swarmService.bindDevice(teamId, 'dev-first-role');

    submitSwarmTask('task-swarm-first', teamId);
    const payload = sent[0]?.envelope.payload as TaskSubmit;
    expect(payload.systemPrompt).toContain('ALPHA_ID');
    expect(payload.systemPrompt).not.toContain('BETA_ID');
  });

  it('非 swarm 任务不注入 systemPrompt（回归保护）', () => {
    registerDevice('dev-auto');
    seedAgent('dev-auto', 'grok', { capabilities: [] });
    enqueueTask({
      taskId: 'task-auto-1',
      sessionId: 'sess-auto',
      origin: 'dashboard',
      originRef: 'qa-swarm',
      prompt: 'hello',
      targetMode: 'device',
      targetDeviceId: 'dev-auto',
    });

    expect(getTask('task-auto-1')?.status).toBe('running');
    const payload = sent[0]?.envelope.payload as TaskSubmit;
    expect(payload.prompt).toBe('hello');
    expect(payload.systemPrompt).toBeUndefined();
  });
});

// ============================================================
// I. 多设备饱和度回归（DEFECT-SWARM-01）
// ============================================================
describe('I. 多设备饱和度回归（DEFECT-SWARM-01）', () => {
  /**
   * DEFECT-SWARM-01（P1，backend/src/services/swarm/swarmRouter.ts +
   * backend/src/services/scheduler.ts）：swarmRouter 只返回「第一个命中候选」时，
   * 一旦该候选的 agent 已满员（busy_count == max_concurrency），claim 失败 →
   * 任务原地保持 queued，**不会尝试团队内其它空闲设备**。
   *
   * 修复后：swarmRouter.resolveCandidates 返回完整候选列表，调度器逐个尝试认领。
   */
  it('DEFECT-SWARM-01：首台设备 agent 满员时应派发到团队内空闲设备', () => {
    registerDevice('dev-full');
    seedAgent('dev-full', 'codex', { capabilities: ['coding'] });
    registerDevice('dev-free');
    seedAgent('dev-free', 'codex', { capabilities: ['coding'] });

    const teamId = createTeam('saturation-team', [
      subRoleInput('engineer', { preferredAgentType: 'codex', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-full');
    swarmService.bindDevice(teamId, 'dev-free');
    swarmService.setDeviceSubRoleBinding('dev-full', 'engineer', 'codex');
    swarmService.setDeviceSubRoleBinding('dev-free', 'engineer', 'codex');

    // 模拟 dev-full 的 codex 已被前一个任务占满
    getDb().prepare(`UPDATE agents SET busy_count = 1 WHERE device_id = 'dev-full'`).run();

    enqueueTask({
      taskId: 'task-saturation',
      sessionId: 'sess-saturation',
      origin: 'dashboard',
      originRef: 'qa-swarm',
      prompt: '第二个任务应落到空闲设备',
      targetMode: 'swarm',
      targetRoleTeamId: teamId,
      targetSubRole: 'engineer',
    });

    const row = getTask('task-saturation');
    expect(row?.status).toBe('running');
    expect(row?.target_device_id).toBe('dev-free');
    expect(row?.target_agent_type).toBe('codex');
  });

  it('DEFECT-SWARM-01：团队内设备全部满员时任务保持 queued 且不下发', () => {
    registerDevice('dev-full-a');
    seedAgent('dev-full-a', 'codex', { capabilities: ['coding'] });
    registerDevice('dev-full-b');
    seedAgent('dev-full-b', 'codex', { capabilities: ['coding'] });

    const teamId = createTeam('saturation-all-team', [
      subRoleInput('engineer', { preferredAgentType: 'codex', requiredCapabilities: ['coding'], position: 0 }),
    ]);
    swarmService.bindDevice(teamId, 'dev-full-a');
    swarmService.bindDevice(teamId, 'dev-full-b');
    swarmService.setDeviceSubRoleBinding('dev-full-a', 'engineer', 'codex');
    swarmService.setDeviceSubRoleBinding('dev-full-b', 'engineer', 'codex');

    getDb().prepare(`UPDATE agents SET busy_count = 1`).run();

    enqueueTask({
      taskId: 'task-saturation-all',
      sessionId: 'sess-saturation-all',
      origin: 'dashboard',
      originRef: 'qa-swarm',
      prompt: '无空闲设备时应保持排队',
      targetMode: 'swarm',
      targetRoleTeamId: teamId,
      targetSubRole: 'engineer',
    });

    const row = getTask('task-saturation-all');
    expect(row?.status).toBe('queued');
    expect(row?.target_device_id).toBeNull();
  });
});

// ============================================================
// H. REST 端点
// ============================================================
describe('H. REST 端点（/api/swarm）', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerSwarmRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/swarm/teams 返回列表', async () => {
    createTeam('rest-list', []);
    const res = await app.inject({ method: 'GET', url: '/api/swarm/teams' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: Array<{ slug: string }> };
    expect(body.ok).toBe(true);
    expect(body.data.map((t) => t.slug)).toContain('rest-list');
  });

  it('GET /api/swarm/teams/:id 未知团队 → 404 team_not_found', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/swarm/teams/nope' });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('team_not_found');
  });

  it('POST /api/swarm/teams/:id/sub-roles 非法 slug → 400', async () => {
    const teamId = createTeam('rest-sub', []);
    const res = await app.inject({
      method: 'POST',
      url: `/api/swarm/teams/${teamId}/sub-roles`,
      payload: { slug: 'BAD SLUG', name: 'x', persona: PERSONA, operation: OPERATION },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_slug');
  });

  it('POST /api/swarm/resolve 缺参 → 400；正常 → 200（无设备时 data=null）', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/swarm/resolve', payload: {} });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe('role_team_id_required');

    const teamId = createTeam('rest-resolve', [subRoleInput('r')]);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/swarm/resolve',
      payload: { roleTeamId: teamId, subRoleSlug: 'r' },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { data: unknown }).data).toBeNull();
  });

  it('POST /api/swarm/teams/:id/devices 空 deviceIds → 400', async () => {
    const teamId = createTeam('rest-bind', []);
    const res = await app.inject({
      method: 'POST',
      url: `/api/swarm/teams/${teamId}/devices`,
      payload: { deviceIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('device_ids_required');
  });

  it('POST /api/swarm/teams 同名 slug 冲突 → 400 slug_conflict', async () => {
    createTeam('rest-dup', []);
    const res = await app.inject({
      method: 'POST',
      url: '/api/swarm/teams',
      payload: { name: 'rest-dup-team', slug: 'rest-dup' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('slug_conflict');
  });

  it('POST /api/swarm/teams 子角色 slug 重复 → 400 duplicate_sub_role_slug', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/swarm/teams',
      payload: {
        name: 'rest-dup-sub-team',
        slug: 'rest-dup-sub',
        subRoles: [subRoleInput('dup'), subRoleInput('dup', { position: 1 })],
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('duplicate_sub_role_slug');
  });
});

// ============================================================
// J. 设备 REST 快照（DEFECT-SWARM-02：roleTeamName 与 WS 通道一致）
// ============================================================
describe('J. 设备 REST 快照含 roleTeamName', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerDeviceRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/devices 与 /api/devices/:id 都返回 roleTeamName', async () => {
    const teamId = createTeam('rest-device-team', [subRoleInput('engineer')]);
    registerDevice('dev-rest-snapshot');
    swarmService.bindDevice(teamId, 'dev-rest-snapshot');

    const list = await app.inject({ method: 'GET', url: '/api/devices' });
    const listed = (
      list.json() as { data: Array<{ deviceId: string; roleTeamId: string | null; roleTeamName: string | null }> }
    ).data.find((d) => d.deviceId === 'dev-rest-snapshot');
    expect(listed?.roleTeamId).toBe(teamId);
    expect(listed?.roleTeamName).toBe('rest-device-team-team');

    const detail = await app.inject({ method: 'GET', url: '/api/devices/dev-rest-snapshot' });
    const body = detail.json() as {
      data: { roleTeamId: string | null; roleTeamName: string | null };
    };
    expect(body.data.roleTeamId).toBe(teamId);
    expect(body.data.roleTeamName).toBe('rest-device-team-team');
  });
});
