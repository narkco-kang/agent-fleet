import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskStatus } from '@agentfleet/shared';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as loopService from '../src/services/loop/loopService.js';
import { LoopScheduler } from '../src/services/loop/loopScheduler.js';
import type { SchedulerSubmitInput } from '../src/services/scheduler.js';

/**
 * Loop DAG 对抗性故障注入：验证编排器在异常输入/乱序/重复下不崩、不重复入队、不丢依赖。
 * 补强「可依赖编排」护城河（重复 tick 幂等 / 乱序依赖完成 / map 部分失败 / 依赖失败阻断）。
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-loop-fault-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMock() {
  const taskStatuses = new Map<string, TaskStatus>();
  const enqueued: Array<{ input: SchedulerSubmitInput; taskId: string }> = [];
  let seq = 0;
  const scheduler = new LoopScheduler({
    enqueueTask: (input) => {
      const taskId = `t${++seq}`;
      enqueued.push({ input, taskId });
      taskStatuses.set(taskId, 'queued');
      return taskId;
    },
    getTaskStatus: (taskId) => taskStatuses.get(taskId),
  });
  return { scheduler, taskStatuses, enqueued };
}

describe('Loop DAG 对抗性故障注入', () => {
  it('重复 tick 幂等：step 已入队后不重复入队', () => {
    const loop = loopService.create({
      name: 'idempotent-loop',
      steps: [
        { id: 'a', name: 'A', template: { prompt: 'pa', target: { mode: 'auto' }, options: {} }, dependsOn: [] },
      ],
      targets: [],
    });
    const { scheduler, enqueued } = makeMock();

    scheduler.start(loop.id);
    expect(enqueued).toHaveLength(1);

    // 连续多次 tick（模拟定时器/事件风暴），未完成前不重复入队
    scheduler.tick();
    scheduler.tick();
    scheduler.tick();
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].input.prompt).toBe('pa');
  });

  it('乱序依赖完成：b 先完成 a 后完成，c 仅在两者都完成后入队一次', () => {
    const loop = loopService.create({
      name: 'out-of-order-loop',
      steps: [
        { id: 'a', name: 'A', template: { prompt: 'pa', target: { mode: 'auto' }, options: {} }, dependsOn: [] },
        { id: 'b', name: 'B', template: { prompt: 'pb', target: { mode: 'auto' }, options: {} }, dependsOn: [] },
        { id: 'c', name: 'C', template: { prompt: 'pc', target: { mode: 'auto' }, options: {} }, dependsOn: ['a', 'b'] },
      ],
      targets: [],
    });
    const { scheduler, taskStatuses, enqueued } = makeMock();

    scheduler.start(loop.id);
    // a、b 同批入队（顺序 a,b）
    expect(enqueued.map((e) => e.input.prompt)).toEqual(['pa', 'pb']);

    // 乱序：b 先完成，a 仍未完成 → c 不应入队
    taskStatuses.set(enqueued[1].taskId, 'completed');
    scheduler.tick();
    expect(enqueued.map((e) => e.input.prompt)).toEqual(['pa', 'pb']);

    // a 再完成 → c 入队一次
    taskStatuses.set(enqueued[0].taskId, 'completed');
    scheduler.tick();
    expect(enqueued.map((e) => e.input.prompt)).toEqual(['pa', 'pb', 'pc']);
    expect(enqueued.filter((e) => e.input.prompt === 'pc')).toHaveLength(1);
  });

  it('map 部分失败：任一 target 失败 → step failed → loop failed', () => {
    const loop = loopService.create({
      name: 'map-fail-loop',
      steps: [
        { id: 'm', name: 'M', template: { prompt: 'pm', target: { mode: 'device' }, options: {} }, dependsOn: [], operator: 'map' },
      ],
      targets: ['dev-1', 'dev-2', 'dev-3'],
    });
    const { scheduler, taskStatuses, enqueued } = makeMock();

    scheduler.start(loop.id);
    expect(enqueued).toHaveLength(3);

    // 部分成功部分失败
    taskStatuses.set(enqueued[0].taskId, 'completed');
    taskStatuses.set(enqueued[1].taskId, 'completed');
    taskStatuses.set(enqueued[2].taskId, 'failed');

    scheduler.tick();
    expect(loopService.get(loop.id)?.state).toBe('failed');
    expect(scheduler.isActive(loop.id)).toBe(false);
  });

  it('依赖失败阻断：上游失败，下游永不派发，loop failed', () => {
    const loop = loopService.create({
      name: 'dep-fail-loop',
      steps: [
        { id: 'a', name: 'A', template: { prompt: 'pa', target: { mode: 'auto' }, options: {} }, dependsOn: [] },
        { id: 'c', name: 'C', template: { prompt: 'pc', target: { mode: 'auto' }, options: {} }, dependsOn: ['a'] },
      ],
      targets: [],
    });
    const { scheduler, taskStatuses, enqueued } = makeMock();

    scheduler.start(loop.id);
    expect(enqueued).toHaveLength(1);

    // 上游 a 失败
    taskStatuses.set(enqueued[0].taskId, 'failed');
    scheduler.tick();

    expect(loopService.get(loop.id)?.state).toBe('failed');
    // c 永不派发
    expect(enqueued.map((e) => e.input.prompt)).toEqual(['pa']);
  });
});
