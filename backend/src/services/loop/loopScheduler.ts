import type { Loop, LoopStep, TaskStatus } from '@agentmesh/shared';
import { isTerminalLoopState, isTerminalTaskStatus } from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import { actionGuard } from '../actionGuard.js';
import type { SchedulerSubmitInput } from '../scheduler.js';
import { enqueueTask } from '../scheduler.js';
import { getTask } from '../../db/repo/tasks.js';
import * as loopService from './loopService.js';

/**
 * Loop 编排器：逐 round 逐 step 把任务模板转成 enqueueTask()（复用 tasks 状态机），
 * 监听 step 任务终态推进 currentStepIndex，一轮完成 currentRound+1。
 *
 * - 依赖注入：enqueueTask / getTaskStatus 可在单测中 mock，确保 tick() 确定性。
 * - 状态：completed 步进；failed/cancelled/interrupted 步失败 → loop 置 failed。
 * - pause/cancel 中断推进。
 */

export interface LoopSchedulerDeps {
  enqueueTask: (input: SchedulerSubmitInput) => string;
  getTaskStatus: (taskId: string) => TaskStatus | undefined;
}

/** 单个 step 的运行记录 */
interface StepRun {
  taskId: string;
  status: TaskStatus;
}

interface ActiveLoop {
  loopId: string;
  stepTasks: Map<string, StepRun>;
}

export class LoopScheduler {
  private readonly active = new Map<string, ActiveLoop>();
  private timer: NodeJS.Timeout | null = null;
  private readonly deps: LoopSchedulerDeps;

  constructor(deps?: Partial<LoopSchedulerDeps>) {
    this.deps = {
      enqueueTask: (input) => enqueueTask(input),
      getTaskStatus: (taskId) => getTask(taskId)?.status,
      ...deps,
    };
  }

  /** 启动 loop（actionGuard 确认后调用） */
  start(loopId: string): boolean {
    const loop = loopService.get(loopId);
    if (!loop || loop.steps.length === 0) return false;
    loopService.setState(loopId, 'running');
    loopService.setProgress(loopId, 0, 0);
    this.active.set(loopId, { loopId, stepTasks: new Map() });
    this.tick();
    return true;
  }

  pause(loopId: string): boolean {
    const loop = loopService.get(loopId);
    if (!loop || loop.state !== 'running') return false;
    loopService.setState(loopId, 'paused');
    return true;
  }

  resume(loopId: string): boolean {
    const loop = loopService.get(loopId);
    if (!loop || loop.state !== 'paused') return false;
    loopService.setState(loopId, 'running');
    this.tick();
    return true;
  }

  cancel(loopId: string): boolean {
    const loop = loopService.get(loopId);
    if (!loop) return false;
    loopService.setState(loopId, 'cancelled');
    this.active.delete(loopId);
    return true;
  }

  isActive(loopId: string): boolean {
    return this.active.has(loopId);
  }

  activeLoopIds(): string[] {
    return Array.from(this.active.keys());
  }

  /** step 模板 → 调度输入 */
  private toSubmitInput(loop: Loop, step: LoopStep): SchedulerSubmitInput {
    return {
      taskId: randomId('task'),
      sessionId: randomId('session'),
      origin: 'dashboard',
      originRef: `loop:${loop.id}:${step.id}`,
      prompt: step.template.prompt,
      targetMode: step.template.target.mode,
      targetDeviceId: step.template.target.deviceId,
      targetAgentType: step.template.target.agentType,
      targetRole: step.template.target.role,
      requireCapability: step.template.target.requireCapability,
    };
  }

  /** 推进一轮：刷新终态 → 依赖检查 → 入队 → 步进。同步且幂等，供定时器与单测调用。 */
  tick(): void {
    for (const [loopId, active] of Array.from(this.active.entries())) {
      const loop = loopService.get(loopId);
      if (!loop) {
        this.active.delete(loopId);
        continue;
      }
      if (loop.state !== 'running') {
        if (isTerminalLoopState(loop.state)) this.active.delete(loopId);
        continue;
      }

      // 1) 刷新 in-flight step 任务终态
      for (const [stepId, run] of active.stepTasks) {
        if (!isTerminalTaskStatus(run.status)) {
          const status = this.deps.getTaskStatus(run.taskId);
          if (status && isTerminalTaskStatus(status)) run.status = status;
        }
      }

      const steps = loop.steps;

      // 2) 一轮完成 → 下一轮
      if (loop.currentStepIndex >= steps.length) {
        loopService.setProgress(loopId, loop.currentRound + 1, 0);
        active.stepTasks.clear();
        continue;
      }

      const step = steps[loop.currentStepIndex];
      if (!step) {
        loopService.setProgress(loopId, loop.currentRound + 1, 0);
        active.stepTasks.clear();
        continue;
      }

      // 3) 依赖满足检查
      const depsOk = step.dependsOn.every(
        (depId) => active.stepTasks.get(depId)?.status === 'completed',
      );
      if (!depsOk) continue;

      // 4) 当前 step 未入队 → 入队
      const run = active.stepTasks.get(step.id);
      if (!run) {
        const taskId = this.deps.enqueueTask(this.toSubmitInput(loop, step));
        active.stepTasks.set(step.id, { taskId, status: 'queued' });
        continue;
      }

      // 5) 依据终态推进
      if (run.status === 'completed') {
        loopService.setProgress(loopId, loop.currentRound, loop.currentStepIndex + 1);
        continue;
      }
      if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'interrupted') {
        loopService.setState(loopId, 'failed');
        this.active.delete(loopId);
        continue;
      }
      // queued/running → 等待下一 tick
    }
  }

  /** 启动后台定时器 */
  startTicker(intervalMs = 2_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  stopTicker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** 全局单例 */
export const loopScheduler = new LoopScheduler();

/** 注册 actionGuard 执行器（loop_start 确认后启动） */
export function registerLoopExecutor(): void {
  actionGuard.registerExecutor('loop_start', (refId) => {
    loopScheduler.start(refId);
  });
}
