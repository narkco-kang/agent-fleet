import type { Loop, LoopState, LoopStep, LoopTrigger } from '@agentmesh/shared';
import { randomId } from '../../security/auth.js';
import {
  createLoop,
  deleteLoop,
  getLoop,
  listLoops,
  updateLoop,
  updateLoopProgress,
  updateLoopState,
} from '../../db/repo/loops.js';

/**
 * Loop 编排服务：Loop CRUD + 状态/进度更新。
 * 调度编排逻辑见 loopScheduler（step → enqueueTask）。
 */

export interface LoopCreateInput {
  name: string;
  steps?: LoopStep[];
  trigger?: LoopTrigger;
  targets?: string[];
}

export interface LoopUpdateInput {
  name?: string;
  steps?: LoopStep[];
  trigger?: LoopTrigger;
  targets?: string[];
}

export function create(input: LoopCreateInput): Loop {
  if (!input.name || typeof input.name !== 'string') {
    throw new Error('loop name required');
  }
  return createLoop({
    loopId: randomId('loop'),
    name: input.name,
    steps: input.steps ?? [],
    trigger: input.trigger ?? 'manual',
    targets: input.targets ?? [],
  });
}

export function get(loopId: string): Loop | undefined {
  return getLoop(loopId);
}

export function list(): Loop[] {
  return listLoops();
}

export function update(loopId: string, patch: LoopUpdateInput): Loop | undefined {
  return updateLoop(loopId, {
    name: patch.name,
    steps: patch.steps,
    trigger: patch.trigger,
    targets: patch.targets,
  });
}

export function remove(loopId: string): void {
  deleteLoop(loopId);
}

export function setState(loopId: string, state: LoopState): void {
  updateLoopState(loopId, state);
}

export function setProgress(loopId: string, round: number, stepIndex: number): void {
  updateLoopProgress(loopId, round, stepIndex);
}
