import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents } from '../src/db/repo/agents.js';
import { getTask } from '../src/db/repo/tasks.js';
import { getDevice, setDeviceTeams, upsertDevice } from '../src/db/repo/devices.js';
import * as teamService from '../src/services/teams/teamService.js';
import { enqueueTask, pickTarget } from '../src/services/scheduler.js';
import type { Team } from '@agentfleet/shared';

/**
 * 多设备团队模式：A 设备=软件开发团队，B 设备=内容专家团队。
 * 验证按设备绑定 + 团队模式只在该团队设备上选目标。
 */

let tmpDir: string;
let software: Team;
let content: Team;

function registerDevice(deviceId: string, agentType: 'codex' | 'claude'): void {
  deviceRegistry.register(deviceId, deviceId, 'relay');
  upsertDevice({
    deviceId,
    name: deviceId,
    hostname: deviceId,
    os: { platform: 'darwin', arch: 'arm64', release: '25.0' },
    version: '0.1.0',
  });
  upsertAgents(deviceId, [
    {
      agentType,
      displayName: agentType,
      version: '1.0.0',
      executable: agentType,
      status: 'available',
      detectMethod: 'which',
      capabilities: [],
      maxConcurrency: 1,
    },
  ]);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-teams-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const e of Array.from(deviceRegistry.all())) deviceRegistry.remove(e.deviceId);
  setDeviceTeams(['dev-a', 'dev-b'], null);
  registerDevice('dev-a', 'codex');
  registerDevice('dev-b', 'claude');

  software = teamService.create({
    name: '软件开发团队',
    description: '负责架构、编码、测试与代码审查',
    purpose: 'software',
    members: [
      { role: 'coding', deviceId: 'dev-a', agentType: 'codex' },
      { role: 'review', deviceId: 'dev-a', agentType: 'codex' },
    ],
  });
  content = teamService.create({
    name: '内容专家团队',
    description: '负责文案、选题与内容润色',
    purpose: 'content',
    members: [{ role: 'writing', deviceId: 'dev-b', agentType: 'claude' }],
  });
});

describe('多设备团队模式（按设备绑定）', () => {
  it('创建团队带 description/purpose，可按设备分别绑定不同团队', () => {
    expect(teamService.bindDevice(software.id, 'dev-a')).toBe(true);
    expect(teamService.bindDevice(content.id, 'dev-b')).toBe(true);

    const bindings = teamService.listBindings();
    expect(bindings).toHaveLength(2);
    expect(bindings.find((b) => b.deviceId === 'dev-a')).toMatchObject({
      teamId: software.id,
      teamName: '软件开发团队',
      purpose: 'software',
    });
    expect(bindings.find((b) => b.deviceId === 'dev-b')).toMatchObject({
      teamId: content.id,
      teamName: '内容专家团队',
      purpose: 'content',
    });

    expect(getDevice('dev-a')?.team_id).toBe(software.id);
    expect(getDevice('dev-b')?.team_id).toBe(content.id);
  });

  it('getTeamForDevice 返回设备自己的团队（不是全局唯一团队）', () => {
    teamService.bindDevice(software.id, 'dev-a');
    teamService.bindDevice(content.id, 'dev-b');

    expect(teamService.getTeamForDevice('dev-a')?.team.name).toBe('软件开发团队');
    expect(teamService.getTeamForDevice('dev-b')?.team.name).toBe('内容专家团队');
    expect(teamService.getTeamForDevice('dev-c')).toBeNull();
  });

  it('团队模式路由：软件开发任务只落到 A 设备，内容任务只落到 B 设备', () => {
    teamService.bindDevice(software.id, 'dev-a');
    teamService.bindDevice(content.id, 'dev-b');

    const devTask = pickTarget({
      task_id: 't-dev',
      target_mode: 'team',
      target_device_id: null,
      target_agent_type: null,
      target_role: 'coding',
      target_team_id: software.id,
      require_capability: null,
    });
    expect(devTask?.deviceId).toBe('dev-a');
    expect(devTask?.agent.agent_type).toBe('codex');

    const contentTask = pickTarget({
      task_id: 't-content',
      target_mode: 'team',
      target_device_id: null,
      target_agent_type: null,
      target_role: 'writing',
      target_team_id: content.id,
      require_capability: null,
    });
    expect(contentTask?.deviceId).toBe('dev-b');
    expect(contentTask?.agent.agent_type).toBe('claude');
  });

  it('团队模式未指定 role → 按团队成员顺序选；未知团队 → null', () => {
    teamService.bindDevice(software.id, 'dev-a');
    const picked = pickTarget({
      task_id: 't-auto-role',
      target_mode: 'team',
      target_device_id: null,
      target_agent_type: null,
      target_role: null,
      target_team_id: software.id,
      require_capability: null,
    });
    expect(picked?.deviceId).toBe('dev-a');

    const missing = pickTarget({
      task_id: 't-missing',
      target_mode: 'team',
      target_device_id: null,
      target_agent_type: null,
      target_role: null,
      target_team_id: 'no-such-team',
      require_capability: null,
    });
    expect(missing).toBeNull();
  });

  it('团队模式 + target.mode=team 经 enqueueTask/dispatch 落到团队设备', () => {
    teamService.bindDevice(content.id, 'dev-b');
    enqueueTask({
      taskId: 'task-team-1',
      sessionId: 'sess-team-1',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一篇产品发布文案',
      targetMode: 'team',
      targetTeamId: content.id,
      targetRole: 'writing',
    });
    const row = getTask('task-team-1');
    expect(row?.target_device_id).toBe('dev-b');
    expect(row?.target_agent_type).toBe('claude');
    expect(row?.status).toBe('running');
  });

  it('解绑设备 / 删除团队时自动解绑', () => {
    teamService.bindDevice(software.id, 'dev-a');
    expect(teamService.unbindDevice('dev-a', software.id)).toBe(true);
    expect(getDevice('dev-a')?.team_id).toBeNull();

    teamService.bindDevice(content.id, 'dev-b');
    teamService.remove(content.id);
    expect(getDevice('dev-b')?.team_id).toBeNull();
  });

  it('批量绑定与缺失设备上报', () => {
    const res = teamService.bindDevices(software.id, ['dev-a', 'dev-x']);
    expect(res.changed).toBe(1);
    expect(res.missing).toEqual(['dev-x']);
    expect(teamService.teamDeviceIds(software.id)).toContain('dev-a');
  });
});
