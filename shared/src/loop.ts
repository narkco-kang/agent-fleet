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

/** Loop 步骤算子（P2-2 编排确定性，借鉴 SwarmFlow 五算子简化） */
export type LoopStepOperator =
  /** 顺序（默认）：单任务，靠 dependsOn 串成链 */
  | 'sequence'
  /** 并行：无依赖，与其它并行 step 同批派发 */
  | 'parallel'
  /** 映射：对 loop.targets 每个 target 各派发一个任务 */
  | 'map'
  /** 人工：等待人工 resolve（human-in-the-loop） */
  | 'human';

/** Loop 单个步骤 */
export interface LoopStep {
  id: string;
  name: string;
  template: LoopTaskTemplate;
  /** 步骤依赖（step id 列表） */
  dependsOn: string[];
  /** 条件表达式（P1 预留） */
  condition?: string;
  /** 算子（默认 sequence） */
  operator?: LoopStepOperator;
}

/** Loop 收敛状态（P0-1，借鉴 Orca evaluateDagConvergence） */
export type LoopConvergence =
  /** 无步骤 */
  | 'empty'
  /** 全部步骤完成 */
  | 'all_done'
  /** 有 in-flight / 可派发步骤 */
  | 'active'
  /** 某步骤失败 */
  | 'failed'
  /** 依赖环 / 依赖永久阻塞（stuck） */
  | 'stuck';

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
