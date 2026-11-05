import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents, setAgentActivated, claimAgent } from '../src/db/repo/agents.js';
import { upsertDevice } from '../src/db/repo/devices.js';
import { getTask } from '../src/db/repo/tasks.js';
import { listMessagesByTask } from '../src/db/repo/messages.js';
import { enqueueTask } from '../src/services/scheduler.js';
import {
  initTaskRunner,
  onDeviceTaskResult,
  onDeviceTaskEvent,
  onDeviceDisconnected,
  runningCount,
} from '../src/services/taskRunner.js';
import { createGate, resolveGate } from '../src/db/repo/decisionGates.js';
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

  it('断连迁移后旧设备迟到 result 被忽略，不覆盖迁移后的 queued 状态', () => {
    registerDevice('dev-fi5');
    seedAgent('dev-fi5', 'codex');
    enqueueTask({
      taskId: 'task-fi5',
      sessionId: 'sess-fi5',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-fi5',
      targetAgentType: 'codex',
    });
    expect(getTask('task-fi5')?.status).toBe('running');

    // 设备断线 → 任务自动迁移（running → queued）
    onDeviceDisconnected('dev-fi5');
    expect(getTask('task-fi5')?.status).toBe('queued');

    // 旧设备网络恢复后迟到上报 completed result（对抗：乱序/延迟）
    onDeviceTaskResult(completedResult('task-fi5'));

    // 迁移后的任务不应被旧设备迟到的 result 覆盖为 completed
    expect(getTask('task-fi5')?.status).toBe('queued');
  });

  it('空/null 输入防御：不崩溃', () => {
    // null / undefined / 空 taskId 的 result 与 event 均不应抛异常
    expect(() => onDeviceTaskResult(null as never)).not.toThrow();
    expect(() => onDeviceTaskResult({} as never)).not.toThrow();
    expect(() => onDeviceTaskEvent(null as never)).not.toThrow();
    expect(() => onDeviceTaskEvent({} as never)).not.toThrow();
    expect(() => onDeviceTaskEvent({ taskId: '', seq: 1, eventType: 'text', data: {}, ts: Date.now() })).not.toThrow();
  });

  it('决策门重复 resolve 幂等：第二次返回 undefined 且状态不变', () => {
    const gate = createGate('task-fi6', '是否继续', ['继续', '终止']);
    expect(gate.status).toBe('open');

    // 第一次 resolve 成功
    const r1 = resolveGate(gate.gateId, '继续');
    expect(r1?.status).toBe('resolved');
    expect(r1?.resolvedOption).toBe('继续');

    // 重复 resolve：返回 undefined，且不覆盖已解析的选项
    const r2 = resolveGate(gate.gateId, '终止');
    expect(r2).toBeUndefined();
    expect(resolveGate(gate.gateId, '继续')).toBeUndefined();

    // 非法选项（未 resolve 的新 gate）也应拒绝
    const gate2 = createGate('task-fi7', '选择', ['A', 'B']);
    expect(resolveGate(gate2.gateId, 'C')).toBeUndefined();
  });

  it('跨设备伪造 result 被拒绝：非归属设备上报结果不落库、任务保持 running', () => {
    registerDevice('dev-owner');
    registerDevice('dev-attacker');
    seedAgent('dev-owner', 'codex');
    enqueueTask({
      taskId: 'task-spoof',
      sessionId: 'sess-spoof',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-owner',
      targetAgentType: 'codex',
    });
    expect(getTask('task-spoof')?.status).toBe('running');

    // 攻击者设备伪造 result（owner=dev-owner，from=dev-attacker → 拒绝）
    onDeviceTaskResult(completedResult('task-spoof'), 'dev-attacker');
    expect(getTask('task-spoof')?.status).toBe('running'); // 未被伪造完成

    // 归属设备上报 result → 正常完成
    onDeviceTaskResult(completedResult('task-spoof'), 'dev-owner');
    expect(getTask('task-spoof')?.status).toBe('completed');
  });

  it('跨设备伪造事件被拒绝：非归属设备上报流式事件不污染时间线', () => {
    registerDevice('dev-owner2');
    seedAgent('dev-owner2', 'claude');
    enqueueTask({
      taskId: 'task-spoof2',
      sessionId: 'sess-spoof2',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: '写一个工具函数',
      targetMode: 'device',
      targetDeviceId: 'dev-owner2',
      targetAgentType: 'claude',
    });
    const before = listMessagesByTask('task-spoof2', 500).length;

    // 非归属设备伪造 text 事件
    onDeviceTaskEvent(
      { taskId: 'task-spoof2', seq: 1, eventType: 'text', data: { text: '伪造输出' }, ts: Date.now() },
      'dev-attacker',
    );

    expect(listMessagesByTask('task-spoof2', 500).length).toBe(before); // 时间线未污染
  });

  it('认领竞态：max_concurrency=1 时连续两次认领只成功一次', () => {
    registerDevice('dev-race');
    seedAgent('dev-race', 'codex'); // maxConcurrency=1

    expect(claimAgent('dev-race', 'codex')).toBe(true); // 首次成功
    expect(claimAgent('dev-race', 'codex')).toBe(false); // 满员，第二次失败
  });

  it('重复注册幂等：同 deviceId 重复 register 不产生重复条目', () => {
    registerDevice('dev-dup');
    registerDevice('dev-dup');

    const entries = Array.from(deviceRegistry.all()).filter((e) => e.deviceId === 'dev-dup');
    expect(entries).toHaveLength(1);
  });

  it('畸形 taskId 注入：SQL 注入串不崩溃、不破坏 tasks 表', () => {
    const evil = "x'; DROP TABLE tasks;--";
    expect(() =>
      onDeviceTaskResult(
        { taskId: evil, status: 'completed', result: { text: '', exitCode: 0, durationMs: 1 }, logs: [], finishedAt: Date.now() },
        'dev-x',
      ),
    ).not.toThrow();
    // tasks 表仍在（参数化查询，未被注入 drop）
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number };
    expect(row.c).toBeGreaterThanOrEqual(0);
  });
});
