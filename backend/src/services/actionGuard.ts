import type { ActionConfirmation, ActionKind } from '@agentmesh/shared';
import { randomId } from '../security/auth.js';
import { config } from '../config.js';
import {
  createConfirmation,
  getByKindRef,
  getConfirmation,
  listConfirmations,
  updateConfirmationStatus,
} from '../db/repo/confirmations.js';

/**
 * 人工确认开关（横切安全红线）。
 *
 * 对外动作（deploy / asset_deliver / loop_start）统一：
 *   request() → 生成待确认记录 → confirm()/reject() → 放行/拒绝。
 *
 * - 开关：config.actionGuardEnabled=false 时 request() 自动放行（仍留审计记录）。
 * - 执行器：服务层通过 registerExecutor(kind, fn) 注册，confirm 成功后自动触发，
 *   实现「确认 → 执行」闭环，路由层无需感知各服务内部逻辑。
 */

/** 动作执行器：refId = batchId / deliveryId / loopId */
export type ActionExecutor = (refId: string) => void | Promise<void>;

class ActionGuard {
  private readonly executors = new Map<ActionKind, ActionExecutor>();

  /** 是否启用人工确认（读配置开关） */
  isEnabled(): boolean {
    return config.actionGuardEnabled;
  }

  /** 注册动作执行器 */
  registerExecutor(kind: ActionKind, executor: ActionExecutor): void {
    this.executors.set(kind, executor);
  }

  /** 请求执行一个对外动作：生成待确认记录（开关关闭时自动放行） */
  request(kind: ActionKind, refId: string, payloadSummary: string): ActionConfirmation {
    const confirmation = createConfirmation({
      confirmationId: randomId('confirm'),
      kind,
      refId,
      payloadSummary,
    });

    // 开关关闭 → 自动确认并触发执行
    if (!this.isEnabled()) {
      this.confirm(confirmation.id, 'auto');
    }

    return getConfirmation(confirmation.id) as ActionConfirmation;
  }

  /** 确认一个动作（按确认记录 id） */
  confirm(id: string, by: string): ActionConfirmation | undefined {
    const rec = getConfirmation(id);
    if (!rec || rec.status !== 'pending_confirmation') return undefined;

    updateConfirmationStatus(id, 'confirmed', by);

    const executor = this.executors.get(rec.kind);
    if (executor) {
      // fire-and-forget：部署/loop 执行耗时长，确认接口不阻塞
      void Promise.resolve()
        .then(() => executor(rec.refId))
        .catch((err) => console.error(`[actionGuard] ${rec.kind} 执行器失败:`, err));
    }

    // 「executed」表示动作已触发执行（不等同于业务终态）
    updateConfirmationStatus(id, 'executed');
    return getConfirmation(id);
  }

  /** 按 kind + refId 确认（REST 路径常用） */
  confirmByRef(kind: ActionKind, refId: string, by: string): ActionConfirmation | undefined {
    const rec = getByKindRef(kind, refId);
    if (!rec) return undefined;
    return this.confirm(rec.id, by);
  }

  /** 拒绝一个动作 */
  reject(id: string, by: string): ActionConfirmation | undefined {
    const rec = getConfirmation(id);
    if (!rec || rec.status !== 'pending_confirmation') return undefined;
    updateConfirmationStatus(id, 'rejected', by);
    return getConfirmation(id);
  }

  /** 动作是否已确认（执行前校验） */
  isConfirmed(kind: ActionKind, refId: string): boolean {
    const rec = getByKindRef(kind, refId);
    if (!rec) return false;
    return rec.status === 'confirmed' || rec.status === 'executed';
  }

  /** 查询确认记录 */
  get(id: string): ActionConfirmation | undefined {
    return getConfirmation(id);
  }

  /** 列表 */
  list(filter?: { kind?: ActionKind; refId?: string }): ActionConfirmation[] {
    return listConfirmations(filter);
  }
}

/** 全局单例 */
export const actionGuard = new ActionGuard();
