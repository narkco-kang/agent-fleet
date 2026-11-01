import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskStatus } from '@agentmesh/shared';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as loopService from '../src/services/loop/loopService.js';
import { LoopScheduler } from '../src/services/loop/loopScheduler.js';
import type { SchedulerSubmitInput } from '../src/services/scheduler.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmesh-loop-'));
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

    // s2 完成 → index 越界
    taskStatuses.set(enqueued[1].taskId, 'completed');
    scheduler.tick();
    expect(loopService.get(loop.id)?.currentStepIndex).toBe(2);

    // 下一 tick → round+1，stepIndex 归零
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
});
