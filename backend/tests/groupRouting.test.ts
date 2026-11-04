import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents, setAgentActivated } from '../src/db/repo/agents.js';
import { upsertDevice, setDeviceGroup, listDevicesByGroup } from '../src/db/repo/devices.js';
import { getTask } from '../src/db/repo/tasks.js';
import { enqueueTask } from '../src/services/scheduler.js';
import { initTaskRunner } from '../src/services/taskRunner.js';
import type { AgentType } from '@agentfleet/shared';

/**
 * 群组感知：设备分组标签 + group 模式路由（只在指定分组设备上选目标）。
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-group-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
  initTaskRunner();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const e of Array.from(deviceRegistry.all())) deviceRegistry.remove(e.deviceId);
  getDb().exec(`DELETE FROM agents; DELETE FROM devices; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM messages;`);
});

function registerDevice(deviceId: string): void {
  deviceRegistry.register(deviceId, deviceId, 'relay');
  upsertDevice({
    deviceId,
    name: deviceId,
    hostname: deviceId,
    os: { platform: 'darwin', arch: 'arm64', release: '25.0' },
    version: '0.1.0',
  });
}

function seedAgent(deviceId: string, agentType: AgentType): void {
  upsertAgents(deviceId, [
    {
      agentType,
      displayName: agentType,
      version: '1.0.0',
      executable: agentType,
      status: 'available',
      detectMethod: 'which',
      capabilities: ['coding'],
      maxConcurrency: 1,
    },
  ]);
  setAgentActivated(deviceId, agentType, true);
}

describe('群组感知（group 模式路由）', () => {
  it('group 模式路由到分组内设备', () => {
    registerDevice('dev-a');
    setDeviceGroup('dev-a', 'g1');
    seedAgent('dev-a', 'codex');
    registerDevice('dev-b');
    setDeviceGroup('dev-b', 'g2');
    seedAgent('dev-b', 'codex');

    enqueueTask({
      taskId: 'task-g',
      sessionId: 'sess-g',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个函数',
      targetMode: 'group',
      targetGroup: 'g1',
    });

    const row = getTask('task-g');
    expect(row?.status).toBe('running');
    expect(row?.target_device_id).toBe('dev-a'); // 只路由到 g1 分组的设备
  });

  it('未分组设备不被 group 模式选中', () => {
    registerDevice('dev-a');
    setDeviceGroup('dev-a', 'g1');
    seedAgent('dev-a', 'codex');
    registerDevice('dev-b'); // 无分组（group=''）
    seedAgent('dev-b', 'codex');

    enqueueTask({
      taskId: 'task-g2',
      sessionId: 'sess-g2',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个函数',
      targetMode: 'group',
      targetGroup: 'g1',
    });

    expect(getTask('task-g2')?.target_device_id).toBe('dev-a');
  });

  it('分组无在线设备时任务保持 queued', () => {
    registerDevice('dev-a');
    setDeviceGroup('dev-a', 'g1');
    seedAgent('dev-a', 'codex');

    enqueueTask({
      taskId: 'task-g3',
      sessionId: 'sess-g3',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个函数',
      targetMode: 'group',
      targetGroup: 'g-nonexistent',
    });

    expect(getTask('task-g3')?.status).toBe('queued'); // 分组不存在 → 无人认领
  });

  it('listDevicesByGroup 返回分组设备', () => {
    registerDevice('dev-a');
    setDeviceGroup('dev-a', 'g1');
    registerDevice('dev-b');
    setDeviceGroup('dev-b', 'g1');
    registerDevice('dev-c');
    setDeviceGroup('dev-c', 'g2');

    expect(listDevicesByGroup('g1').sort()).toEqual(['dev-a', 'dev-b']);
    expect(listDevicesByGroup('g2')).toEqual(['dev-c']);
    expect(listDevicesByGroup('g-none')).toEqual([]);
  });
});
