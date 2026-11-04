import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents, setAgentActivated } from '../src/db/repo/agents.js';
import { upsertDevice } from '../src/db/repo/devices.js';
import { getTask } from '../src/db/repo/tasks.js';
import { enqueueTask, dispatch } from '../src/services/scheduler.js';
import { initTaskRunner, onDeviceDisconnected, onDeviceTaskEvent } from '../src/services/taskRunner.js';
import { setRelayForward } from '../src/transport/wsServer.js';
import type { AgentType, Envelope, TaskSubmit } from '@agentfleet/shared';

/**
 * P1-3 断点续跑：设备断线时保存部分输出为 checkpoint，重派时注入续跑上下文。
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-checkpoint-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
  initTaskRunner(); // 让 dispatch 走 onDispatched，断开时正确 release
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

describe('断点续跑（P1-3）', () => {
  it('断线保存部分输出为 checkpoint，重派注入续跑上下文', () => {
    registerDevice('dev-cp');
    seedAgent('dev-cp', 'codex');

    enqueueTask({
      taskId: 'task-cp',
      sessionId: 'sess-cp',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个登录接口',
      targetMode: 'device',
      targetDeviceId: 'dev-cp',
      targetAgentType: 'codex',
    });

    expect(getTask('task-cp')?.status).toBe('running');

    // 设备已流式回传部分输出
    onDeviceTaskEvent({
      taskId: 'task-cp',
      seq: 1,
      eventType: 'text',
      data: { text: '部分输出：已创建 controller 骨架' },
      ts: Date.now(),
    });

    // 断线 → 自动迁移
    onDeviceDisconnected('dev-cp');

    const row = getTask('task-cp');
    expect(row?.status).toBe('queued');
    expect(row?.checkpoint).toContain('部分输出：已创建 controller 骨架');

    // 设备重新上线 → 重派，prompt 注入续跑上下文
    const sent: Envelope[] = [];
    setRelayForward((_deviceId, envelope) => {
      sent.push(envelope);
    });
    registerDevice('dev-cp');
    dispatch();

    const submit = sent.find((s) => {
      const p = s.payload as TaskSubmit;
      return p?.taskId === 'task-cp';
    });
    expect(submit).toBeDefined();
    const payload = submit!.payload as TaskSubmit;
    expect(payload.prompt).toContain('【续跑上下文】');
    expect(payload.prompt).toContain('部分输出：已创建 controller 骨架');
  });
});
