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
import { listMessagesByTask } from '../src/db/repo/messages.js';
import { enqueueTask } from '../src/services/scheduler.js';
import {
  initTaskRunner,
  onDeviceTaskResult,
  onDeviceTaskEvent,
  runningCount,
} from '../src/services/taskRunner.js';
import type { AgentType, TaskResult } from '@agentfleet/shared';

/**
 * 对抗性故障注入：验证系统在恶意/异常输入下不崩、不重复、不丢任务。
 * 覆盖：重复 result 幂等、终态后事件忽略、乱序事件、断连后迟到的 result。
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-fault-'));
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

function completedResult(taskId: string): TaskResult {
  return {
    taskId,
    status: 'completed',
    result: { text: '最终输出内容', exitCode: 0, durationMs: 100 },
    logs: [],
    finishedAt: Date.now(),
  };
}

describe('对抗性故障注入', () => {
  it('重复 result 幂等：第二次 completed result 不产生重复消息/重复释放', () => {
    registerDevice('dev-fi');
    seedAgent('dev-fi', 'codex');
    enqueueTask({
      taskId: 'task-fi',
      sessionId: 'sess-fi',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-fi',
      targetAgentType: 'codex',
    });
    expect(getTask('task-fi')?.status).toBe('running');

    onDeviceTaskResult(completedResult('task-fi'));
    expect(getTask('task-fi')?.status).toBe('completed');
    const msgAfterFirst = listMessagesByTask('task-fi', 500).length;
    expect(msgAfterFirst).toBeGreaterThan(0);

    // 重复投递同一 completed result（网络重试/乱序重发）
    onDeviceTaskResult(completedResult('task-fi'));

    // 消息数不增加、状态不被二次改动
    expect(listMessagesByTask('task-fi', 500).length).toBe(msgAfterFirst);
    expect(getTask('task-fi')?.status).toBe('completed');
  });

  it('已完成任务再收 failed result 被忽略，状态不被覆盖', () => {
    registerDevice('dev-fi2');
    seedAgent('dev-fi2', 'claude');
    enqueueTask({
      taskId: 'task-fi2',
      sessionId: 'sess-fi2',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-fi2',
      targetAgentType: 'claude',
    });

    onDeviceTaskResult(completedResult('task-fi2'));
    // 恶意/乱序：完成后再报 failed
    onDeviceTaskResult({ ...completedResult('task-fi2'), status: 'failed' });

    expect(getTask('task-fi2')?.status).toBe('completed'); // 保持完成，不被覆盖为 failed
  });

  it('已完成任务再收 status/text 事件被忽略，不污染时间线', () => {
    registerDevice('dev-fi3');
    seedAgent('dev-fi3', 'codex');
    enqueueTask({
      taskId: 'task-fi3',
      sessionId: 'sess-fi3',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-fi3',
      targetAgentType: 'codex',
    });

    onDeviceTaskResult(completedResult('task-fi3'));
    const msgCount = listMessagesByTask('task-fi3', 500).length;

    // 终态后迟到的流式事件（乱序）
    onDeviceTaskEvent({
      taskId: 'task-fi3',
      seq: 99,
      eventType: 'text',
      data: { text: '迟到的流式输出' },
      ts: Date.now(),
    });
    onDeviceTaskEvent({
      taskId: 'task-fi3',
      seq: 100,
      eventType: 'status',
      status: 'running',
      data: {},
      ts: Date.now(),
    });

    // 时间线不被追加、状态不被回退
    expect(listMessagesByTask('task-fi3', 500).length).toBe(msgCount);
    expect(getTask('task-fi3')?.status).toBe('completed');
  });

  it('running 计数：重复 result 不二次释放', () => {
    registerDevice('dev-fi4');
    seedAgent('dev-fi4', 'codex');
    enqueueTask({
      taskId: 'task-fi4',
      sessionId: 'sess-fi4',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-fi4',
      targetAgentType: 'codex',
    });
    const before = runningCount();
    expect(before).toBe(1);

    onDeviceTaskResult(completedResult('task-fi4'));
    expect(runningCount()).toBe(0); // 已释放

    onDeviceTaskResult(completedResult('task-fi4')); // 重复
    expect(runningCount()).toBe(0); // 不二次释放（保持 0，不出现负数/异常）
  });
});
