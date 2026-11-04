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

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-loop-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createTestLoop() {
  return loopService.create({
    name: 'test-loop',
    steps: [
      {
        id: 's1',
        name: 'step1',
        template: { prompt: 'p1', target: { mode: 'role', role: 'research' }, options: {} },
        dependsOn: [],
      },
      {
        id: 's2',
        name: 'step2',
        template: { prompt: 'p2', target: { mode: 'auto' }, options: {} },
        dependsOn: ['s1'],
      },
    ],
    targets: [],
  });
}

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

describe('loopScheduler 编排', () => {
  it('逐 step 入队、终态推进、一轮完成 round+1', () => {
    const loop = createTestLoop();
    const { scheduler, taskStatuses, enqueued } = makeMock();

    // start 内部即 tick：入队 s1
    expect(scheduler.start(loop.id)).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].input.prompt).toBe('p1');
    expect(enqueued[0].input.targetMode).toBe('role');
    expect(enqueued[0].input.targetRole).toBe('research');

    // s1 完成 → 推进 index，随后入队 s2
    taskStatuses.set(enqueued[0].taskId, 'completed');
    scheduler.tick();
    scheduler.tick();
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1].input.prompt).toBe('p2');

    // s2 完成 → 全部完成 → round+1，stepIndex 归零（DAG 收敛检测）
    taskStatuses.set(enqueued[1].taskId, 'completed');
    scheduler.tick();
    const fresh = loopService.get(loop.id);
    expect(fresh?.currentRound).toBe(1);
    expect(fresh?.currentStepIndex).toBe(0);
  });

  it('pause 停止推进，resume 恢复', () => {
    const loop = createTestLoop();
    const { scheduler, taskStatuses, enqueued } = makeMock();

    scheduler.start(loop.id);
    expect(enqueued).toHaveLength(1);

    scheduler.pause(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('paused');

    taskStatuses.set(enqueued[0].taskId, 'completed');
    scheduler.tick(); // paused → 不推进
    expect(loopService.get(loop.id)?.currentStepIndex).toBe(0);

    scheduler.resume(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('running');
    scheduler.tick(); // 推进 index
    expect(loopService.get(loop.id)?.currentStepIndex).toBe(1);
  });

  it('cancel 后状态 cancelled 且移出 active', () => {
    const loop = createTestLoop();
    const { scheduler } = makeMock();
    scheduler.start(loop.id);
    scheduler.cancel(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('cancelled');
    expect(scheduler.isActive(loop.id)).toBe(false);
  });

  it('step 失败 → loop failed', () => {
    const loop = createTestLoop();
    const { scheduler, taskStatuses, enqueued } = makeMock();
    scheduler.start(loop.id);
    taskStatuses.set(enqueued[0].taskId, 'failed');
    scheduler.tick();
    expect(loopService.get(loop.id)?.state).toBe('failed');
    expect(scheduler.isActive(loop.id)).toBe(false);
  });

  it('P1-4 并行组：无依赖多 step 同批并发入队', () => {
    const loop = loopService.create({
      name: 'parallel-loop',
      steps: [
        { id: 'a', name: 'A', template: { prompt: 'pa', target: { mode: 'auto' }, options: {} }, dependsOn: [] },
        { id: 'b', name: 'B', template: { prompt: 'pb', target: { mode: 'auto' }, options: {} }, dependsOn: [] },
        { id: 'c', name: 'C', template: { prompt: 'pc', target: { mode: 'auto' }, options: {} }, dependsOn: ['a', 'b'] },
      ],
      targets: [],
    });
    const { scheduler, taskStatuses, enqueued } = makeMock();

    scheduler.start(loop.id);
    // a、b 无依赖，同批并发入队；c 依赖 a+b，暂不入队
    expect(enqueued.map((e) => e.input.prompt)).toEqual(['pa', 'pb']);

    // a、b 完成 → c 入队
    taskStatuses.set(enqueued[0].taskId, 'completed');
    taskStatuses.set(enqueued[1].taskId, 'completed');
    scheduler.tick();
    expect(enqueued).toHaveLength(3);
    expect(enqueued[2].input.prompt).toBe('pc');
  });

  it('P2-2 map 算子：对 targets 每个 target 各派发一个任务', () => {
    const loop = loopService.create({
      name: 'map-loop',
      steps: [
        { id: 'm', name: 'M', template: { prompt: 'pm', target: { mode: 'device' }, options: {} }, dependsOn: [], operator: 'map' },
      ],
      targets: ['dev-1', 'dev-2', 'dev-3'],
    });
    const { scheduler, enqueued } = makeMock();

    scheduler.start(loop.id);
    // map 对 3 个 target 各派发一个任务
    expect(enqueued).toHaveLength(3);
    expect(enqueued.map((e) => e.input.targetDeviceId)).toEqual(['dev-1', 'dev-2', 'dev-3']);
  });

  it('P2-2 human 算子：等待 resolveHumanStep 后才推进', () => {
    const loop = loopService.create({
      name: 'human-loop',
      steps: [
        { id: 'h', name: 'H', template: { prompt: 'ph', target: { mode: 'auto' }, options: {} }, dependsOn: [], operator: 'human' },
        { id: 'next', name: 'N', template: { prompt: 'pn', target: { mode: 'auto' }, options: {} }, dependsOn: ['h'] },
      ],
      targets: [],
    });
    const { scheduler, enqueued } = makeMock();

    scheduler.start(loop.id);
    // human 步骤不派发任务
    expect(enqueued).toHaveLength(0);

    // resolve 后 → 下一步入队
    expect(scheduler.resolveHumanStep(loop.id, 'h')).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].input.prompt).toBe('pn');
  });

  it('P0-1 收敛检测：依赖引用不存在 step → stuck → failed', () => {
    const loop = loopService.create({
      name: 'stuck-loop',
      steps: [
        { id: 'x', name: 'X', template: { prompt: 'px', target: { mode: 'auto' }, options: {} }, dependsOn: ['ghost'] },
      ],
      targets: [],
    });
    const { scheduler } = makeMock();

    scheduler.start(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('failed');
    expect(scheduler.isActive(loop.id)).toBe(false);
  });
});
