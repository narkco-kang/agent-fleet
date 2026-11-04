import type { Loop, LoopStep, TaskStatus } from '@agentfleet/shared';
import { isTerminalLoopState, isTerminalTaskStatus } from '@agentfleet/shared';
import { randomId } from '../../security/auth.js';
import { actionGuard } from '../actionGuard.js';
import type { SchedulerSubmitInput } from '../scheduler.js';
import { enqueueTask } from '../scheduler.js';
import { getTask } from '../../db/repo/tasks.js';
import * as loopService from './loopService.js';

/**
 * Loop 编排器（DAG 依赖调度，替代旧的串行 step 指针）。
 *
 * - P0-1 依赖 DAG：dependsOn 满足即派发，不再按 currentStepIndex 串行；收敛检测区分 all_done/failed/stuck。
 * - P1-4 并行组：同一 tick 内多个依赖已满足的 step 并发派发（认领限流由 scheduler 兜底）。
 * - P2-2 编排算子：sequence（默认）/ parallel（无依赖并行）/ map（对 targets 每个 target 派发）/ human（人工）。
 *
 * 依赖注入：enqueueTask / getTaskStatus 可在单测中 mock，确保 tick() 确定性。
 */

export interface LoopSchedulerDeps {
  enqueueTask: (input: SchedulerSubmitInput) => string;
  getTaskStatus: (taskId: string) => TaskStatus | undefined;
}

/** 单个 step 的运行记录（map 算子多任务，sequence/parallel 单任务，human 无任务） */
interface StepRun {
  taskIds: string[];
  /** 聚合状态：任一失败→failed；全部完成→completed；否则 in-flight */
  status: TaskStatus;
  /** human 算子标记 */
  human?: boolean;
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

  /** 人工步骤 resolve（human 算子）：标记该 step 完成 */
  resolveHumanStep(loopId: string, stepId: string): boolean {
    const active = this.active.get(loopId);
    if (!active) return false;
    const run = active.stepTasks.get(stepId);
    if (!run?.human) return false;
    run.status = 'completed';
    run.human = false;
    this.tick();
    return true;
  }

  isActive(loopId: string): boolean {
    return this.active.has(loopId);
  }

  activeLoopIds(): string[] {
    return Array.from(this.active.keys());
  }

  /** step 模板 → 调度输入（map 算子可覆盖 deviceId） */
  private toSubmitInput(loop: Loop, step: LoopStep, deviceId?: string): SchedulerSubmitInput {
    const target = step.template.target;
    return {
      taskId: randomId('task'),
      sessionId: randomId('session'),
      origin: 'dashboard',
      originRef: `loop:${loop.id}:${step.id}`,
      prompt: step.template.prompt,
      targetMode: target.mode,
      targetDeviceId: deviceId ?? target.deviceId,
      targetAgentType: target.agentType,
      targetRole: target.role,
      requireCapability: target.requireCapability,
    };
  }

  /** 派发一个 step（按算子）→ 返回 StepRun */
  private enqueueStep(loop: Loop, step: LoopStep): StepRun {
    const op = step.operator ?? 'sequence';
    if (op === 'human') {
      // 人工步骤：不派发任务，等待 resolveHumanStep
      return { taskIds: [], status: 'queued', human: true };
    }
    if (op === 'map') {
      // map：对 targets 每个 target 派发一个任务
      const deviceIds = loop.targets.length > 0 ? loop.targets : [undefined];
      const taskIds = deviceIds.map((d) => this.deps.enqueueTask(this.toSubmitInput(loop, step, d)));
      return { taskIds, status: 'queued' };
    }
    // sequence / parallel：单任务
    const taskId = this.deps.enqueueTask(this.toSubmitInput(loop, step));
    return { taskIds: [taskId], status: 'queued' };
  }

  /** 聚合 StepRun 状态：任一失败→failed；全部终态完成→completed；否则 in-flight */
  private refreshRun(active: ActiveLoop): void {
    for (const run of active.stepTasks.values()) {
      if (run.human) continue; // human 等待 resolve，不刷新
      if (isTerminalTaskStatus(run.status)) continue;
      const statuses = run.taskIds.map((tid) => this.deps.getTaskStatus(tid));
      const anyFailed = statuses.some((s) => s === 'failed' || s === 'cancelled' || s === 'interrupted');
      const allDone = statuses.every((s) => s === 'completed');
      if (anyFailed) run.status = 'failed';
      else if (allDone) run.status = 'completed';
      // 其余保持 in-flight（queued/running/undefined）
    }
  }

  /** 推进一轮：刷新终态 → 依赖检查 → 入队 → 收敛检测。同步且幂等。 */
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

      const steps = loop.steps;

      // 1) 刷新 in-flight 终态
      this.refreshRun(active);

      // 2) 失败检测：任一 step failed → loop failed
      let failed = false;
      for (const run of active.stepTasks.values()) {
        if (run.status === 'failed') {
          failed = true;
          break;
        }
      }
      if (failed) {
        loopService.setState(loopId, 'failed');
        this.active.delete(loopId);
        continue;
      }

      // 3) 收敛检测：依赖环 / 永久阻塞（stuck）
      if (this.isStuck(steps, active)) {
        loopService.setState(loopId, 'failed');
        this.active.delete(loopId);
        continue;
      }

      // 4) 依赖满足且未入队 → 入队（并行：同 tick 多个可派发 step 一并派发）
      let completedCount = 0;
      for (const step of steps) {
        const run = active.stepTasks.get(step.id);
        if (run) {
          if (run.status === 'completed') completedCount += 1;
          continue;
        }
        const depsOk = step.dependsOn.every(
          (depId) => active.stepTasks.get(depId)?.status === 'completed',
        );
        if (!depsOk) continue;
        active.stepTasks.set(step.id, this.enqueueStep(loop, step));
      }

      // 5) 进度 + 收敛：全部完成 → 下一轮；否则记录已完成 step 数（进度条）
      if (completedCount === steps.length) {
        loopService.setProgress(loopId, loop.currentRound + 1, 0);
        active.stepTasks.clear();
      } else {
        loopService.setProgress(loopId, loop.currentRound, completedCount);
      }
    }
  }

  /** 依赖环 / 依赖永久阻塞检测：存在「未完成」step 且其依赖不存在或已失败 */
  private isStuck(steps: LoopStep[], active: ActiveLoop): boolean {
    const ids = new Set(steps.map((s) => s.id));
    for (const step of steps) {
      const run = active.stepTasks.get(step.id);
      if (run && run.status === 'completed') continue;
      // 未完成 step：检查依赖是否已失败或引用不存在
      for (const depId of step.dependsOn) {
        if (!ids.has(depId)) return true; // 依赖引用不存在的 step → 永久阻塞
        const depRun = active.stepTasks.get(depId);
        if (depRun && depRun.status === 'failed') return true; // 依赖失败 → 永久阻塞
      }
    }
    return false;
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
