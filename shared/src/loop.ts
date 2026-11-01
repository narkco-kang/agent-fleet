import type { LoopState, LoopTrigger } from './status.js';
import type { TaskOptions, TaskTarget } from './task.js';

/**
 * Loop 编排协议（F6）：一组任务模板按顺序/依赖循环执行。
 * 复用 tasks 六态状态机，loopScheduler 负责 step → enqueueTask 编排。
 */

/** Loop 步骤内的任务模板 */
export interface LoopTaskTemplate {
  prompt: string;
  /** 复用 TaskTarget（支持 mode:'role'） */
  target: TaskTarget;
  /** 复用既有任务选项 */
  options: TaskOptions;
}

/** Loop 单个步骤 */
export interface LoopStep {
  id: string;
  name: string;
  template: LoopTaskTemplate;
  /** 步骤依赖（step id 列表） */
  dependsOn: string[];
  /** 条件表达式（P1 预留） */
  condition?: string;
}

/** Loop 编排 */
export interface Loop {
  id: string;
  name: string;
  steps: LoopStep[];
  trigger: LoopTrigger;
  /** deviceId 列表（单/批量/跨设备） */
  targets: string[];
  state: LoopState;
  currentRound: number;
  currentStepIndex: number;
  createdAt: number;
  updatedAt: number;
}
