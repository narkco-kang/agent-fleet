import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { getDevice, getSubRoleBindings, listDevicesByRoleTeam, setSubRoleBindings } from '../src/db/repo/devices.js';
import { createRoleTeam, getRoleTeamBySlug } from '../src/db/repo/roleTeams.js';

/**
 * 老库迁移验收：历史踩坑点是「既有库的 devices/tasks 表不会被 CREATE TABLE IF NOT EXISTS 修改」，
 * 新增列必须由 runMigrations 的 ALTER TABLE 补齐，且补列后才能建依赖新列的索引。
 *
 * 本文件独立进程环境（vitest 按文件隔离模块），先用 better-sqlite3 造一个旧结构库，
 * 再走 initDatabase 触发 schema.sql + runMigrations。
 */

let tmpDir: string;
let dbPath: string;

/** 旧结构（无 team/role_team/sub_role_bindings 相关列）的 devices 表 */
const LEGACY_DEVICES = `
CREATE TABLE devices (
  device_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  hostname       TEXT NOT NULL DEFAULT '',
  os_platform    TEXT NOT NULL DEFAULT '',
  os_arch        TEXT NOT NULL DEFAULT '',
  daemon_version TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'offline',
  last_heartbeat INTEGER,
  lan_addr       TEXT,
  relay_online   INTEGER NOT NULL DEFAULT 0,
  token          TEXT NOT NULL DEFAULT '',
  owner          TEXT NOT NULL DEFAULT 'default',
  created_at     INTEGER NOT NULL
);`;

/** 旧结构（无 target_role / target_team_id / agent_profile / target_role_team_id / target_sub_role）的 tasks 表 */
const LEGACY_TASKS = `
CREATE TABLE tasks (
  task_id            TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  origin             TEXT NOT NULL DEFAULT 'dashboard',
  origin_ref         TEXT NOT NULL DEFAULT '',
  prompt             TEXT NOT NULL DEFAULT '',
  target_mode        TEXT NOT NULL DEFAULT 'auto',
  target_device_id   TEXT,
  target_agent_type  TEXT,
  require_capability TEXT,
  status             TEXT NOT NULL DEFAULT 'queued',
  result_text        TEXT,
  exit_code          INTEGER,
  error              TEXT,
  duration_ms        INTEGER,
  tokens_in          INTEGER,
  tokens_out         INTEGER,
  created_at         INTEGER NOT NULL,
  started_at         INTEGER,
  finished_at        INTEGER
);`;

function columnsOf(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

/** 造一个旧库（含一条设备行 + 一条任务行，验证迁移不丢数据） */
function createLegacyDb(file: string): void {
  const legacy = new Database(file);
  legacy.exec(LEGACY_DEVICES);
  legacy.exec(LEGACY_TASKS);
  legacy
    .prepare(
      `INSERT INTO devices (device_id, name, hostname, os_platform, os_arch, daemon_version, status, last_heartbeat, created_at)
       VALUES ('legacy-dev', '老设备', 'legacy-host', 'darwin', 'arm64', '0.0.9', 'online', 1000, 111)`,
    )
    .run();
  legacy
    .prepare(
      `INSERT INTO tasks (task_id, session_id, prompt, target_mode, status, created_at)
       VALUES ('legacy-task', 'legacy-sess', '老任务', 'auto', 'completed', 222)`,
    )
    .run();
  legacy.close();
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-swarm-migrate-'));
  dbPath = path.join(tmpDir, 'legacy.db');
  createLegacyDb(dbPath);
  config.dbPath = dbPath;
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('老库迁移（ALTER TABLE 补齐蜂群列）', () => {
  it('devices 补 role_team_id / sub_role_bindings（默认 {}）+ 历史列一并补齐', () => {
    const cols = columnsOf('devices');
    expect(cols).toEqual(
      expect.arrayContaining(['role_team_id', 'sub_role_bindings', 'primary_agent_type', 'team_id']),
    );
  });

  it('tasks 补 target_role_team_id / target_sub_role（+ 历史列 target_role/target_team_id/agent_profile）', () => {
    const cols = columnsOf('tasks');
    expect(cols).toEqual(
      expect.arrayContaining([
        'target_role_team_id',
        'target_sub_role',
        'target_role',
        'target_team_id',
        'agent_profile',
      ]),
    );
  });

  it('迁移不丢数据：老设备行可读、新列取默认值', () => {
    const row = getDevice('legacy-dev');
    expect(row).toBeDefined();
    expect(row?.name).toBe('老设备');
    expect(row?.daemon_version).toBe('0.0.9');
    expect(row?.role_team_id).toBeNull();
    expect(row?.sub_role_bindings).toBe('{}');
    expect(row?.team_id).toBeNull();
    expect(getSubRoleBindings('legacy-dev')).toEqual({});
  });

  it('迁移不丢数据：老任务行保留（默认列可读）', () => {
    const task = getDb().prepare(`SELECT * FROM tasks WHERE task_id = 'legacy-task'`).get() as Record<
      string,
      unknown
    >;
    expect(task.prompt).toBe('老任务');
    expect(task.target_role_team_id).toBeNull();
    expect(task.target_sub_role).toBeNull();
  });

  it('role_teams / sub_roles 表在迁移后创建，依赖新列的索引建成', () => {
    const tables = (
      getDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['role_teams', 'sub_roles']));

    const indexes = (
      getDb().prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_devices_role_team',
        'idx_tasks_role_team',
        'idx_role_teams_slug',
        'idx_sub_roles_team',
      ]),
    );
  });

  it('迁移后的库可正常承载蜂群读写（绑团队 + 软绑定往返）', () => {
    createRoleTeam({
      roleTeamId: 'rteam-legacy',
      name: '老库团队',
      slug: 'legacy-team',
      purpose: 'software',
      subRoles: [],
    });
    expect(getRoleTeamBySlug('legacy-team')?.roleTeamId).toBe('rteam-legacy');

    setSubRoleBindings('legacy-dev', { qa: 'grok' });
    expect(getSubRoleBindings('legacy-dev')).toEqual({ qa: 'grok' });

    getDb().prepare(`UPDATE devices SET role_team_id = ? WHERE device_id = ?`).run('rteam-legacy', 'legacy-dev');
    expect(listDevicesByRoleTeam('rteam-legacy')).toEqual(['legacy-dev']);
  });

  it('重复初始化（二次启动）不报错、不重复加列', () => {
    closeDatabase();
    expect(() => initDatabase()).not.toThrow();
    const cols = columnsOf('devices');
    expect(cols.filter((c) => c === 'role_team_id')).toHaveLength(1);
    expect(cols.filter((c) => c === 'sub_role_bindings')).toHaveLength(1);
    // 数据仍在
    expect(getDevice('legacy-dev')?.name).toBe('老设备');
    expect(getSubRoleBindings('legacy-dev')).toEqual({ qa: 'grok' });
  });
});
