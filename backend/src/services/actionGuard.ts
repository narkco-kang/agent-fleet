import type { ActionConfirmation, ActionKind } from '@agentfleet/shared';
import { key, reasonJson, reasonOf } from '@agentfleet/shared';
import { randomId } from '../security/auth.js';
import { config } from '../config.js';
import { tieredPolicy } from './tieredPolicy.js';
import { effectQueue } from './effects/effectQueue.js';
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
 * 对外动作（deploy / uninstall / asset_deliver / loop_start）统一：
 *   request() → 生成待确认记录（锁 policyVersion）→ confirm()/reject() → 放行/拒绝。
 *
 * DSH 架构融合（docs/29）：
 *   - **单写者 + 每命令一个事务**：confirm 在 `effectQueue.transaction()` 内完成
 *     「状态变更 + 副作用登记」，两者同生共死；
 *   - **提交后才执行**：enqueue 只写行，drain 在 microtask（事务提交后）派发，
 *     不再是 `void Promise.then(...)` 的 fire-and-forget；
 *   - **持久副作用队列**：失败自动指数退避重试、崩溃重启续跑、耗尽标 dead 待人处理；
 *   - **Mandate revalidate**：confirm 时复检策略，若已改 deny 则拒绝（结构化原因码）。
 *
 * - 开关：config.actionGuardEnabled=false 时 request() 自动放行（仍留审计记录）。
 * - 执行器：服务层通过 registerExecutor(kind, fn) 注册，队列 handler 按 kind 分派。
 */

/** 动作执行器：refId = batchId / deliveryId / loopId */
export type ActionExecutor = (refId: string) => void | Promise<void>;

/** 四类对外动作（与 tieredPolicy 档位表一致） */
const ACTION_KINDS: ActionKind[] = ['deploy', 'uninstall', 'asset_deliver', 'loop_start'];

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

  /**
   * 启动时预热队列 handler。
   * 崩溃恢复依赖这一步：DB 里残留的 pending 行必须有对应 handler 才能被 drain 执行，
   * 否则会一直堆在队列里（懒注册只在 confirm() 时触发，而重启后不会再 confirm 一次）。
   */
  primeEffectHandlers(): void {
    this.ensureEffectHandlers();
  }

  /**
   * 懒注册队列 handler（按 kind 检查而非布尔位，便于 reset 后重新注册）。
   * 没有注册执行器时视为「无副作用可做」→ 成功结算，不产生无意义重试。
   */
  private ensureEffectHandlers(): void {
    for (const kind of ACTION_KINDS) {
      if (effectQueue.hasHandler(kind)) continue;
      effectQueue.register(
        kind,
        async (payload) => {
          const executor = this.executors.get(kind);
          if (!executor) return;
          await executor(String(payload.refId ?? ''));
        },
        // 部署/卸载耗时长且要 SSH：并发 2、退避 5s→300s；资产分发并发 4、2s→60s
        kind === 'deploy' || kind === 'uninstall'
          ? { limit: 2, retry: [5000, 300000], maxAttempts: 4 }
          : { limit: 4, retry: [2000, 60000], maxAttempts: 6 },
      );
    }
  }

  /** 请求执行一个对外动作：按权限目录三档（allow/ask/deny）生成确认记录 */
  request(kind: ActionKind, refId: string, payloadSummary: string): ActionConfirmation {
    const confirmation = createConfirmation({
      confirmationId: randomId('confirm'),
      kind,
      refId,
      payloadSummary,
      policyVersion: tieredPolicy.version(),
    });

    const tier = tieredPolicy.getTier(kind);
    // deny：自动拒绝，直接拦截（不执行）
    if (tier === 'deny') {
      updateConfirmationStatus(
        confirmation.id,
        'rejected',
        undefined,
        reasonJson(reasonOf('authorizationDenied', { detail: `policy:deny (${kind})` })),
      );
      return getConfirmation(confirmation.id) as ActionConfirmation;
    }

    // allow：自动放行；ask + 开关关闭：自动放行（仍留审计记录）
    if (tier === 'allow' || !this.isEnabled()) {
      this.confirm(confirmation.id, tier === 'allow' ? 'policy:allow' : 'auto');
    }

    return getConfirmation(confirmation.id) as ActionConfirmation;
  }

  /** 确认一个动作（按确认记录 id） */
  confirm(id: string, by: string): ActionConfirmation | undefined {
    const rec = getConfirmation(id);
    if (!rec || rec.status !== 'pending_confirmation') return undefined;

    // Mandate 复检：策略在受理后被改成 deny → 拒绝，但不回溯撤销已有授权
    if (tieredPolicy.getTier(rec.kind) === 'deny') {
      updateConfirmationStatus(
        id,
        'rejected',
        undefined,
        reasonJson(reasonOf('revalidateDenied', { kind: rec.kind })),
      );
      return getConfirmation(id);
    }

    this.ensureEffectHandlers();

    // 一个事务：状态变更 + 副作用登记。回滚则两者一并消失。
    effectQueue.transaction(() => {
      updateConfirmationStatus(id, 'confirmed', by);
      effectQueue.enqueue(rec.kind, key('action', rec.kind, id), {
        kind: rec.kind,
        refId: rec.refId,
        confirmationId: id,
        policyVersion: rec.policyVersion ?? '',
      });
      // 「executed」= 动作已登记待执行（不等同于业务终态），与历史语义一致
      updateConfirmationStatus(id, 'executed');
    });

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
    updateConfirmationStatus(
      id,
      'rejected',
      by,
      reasonJson(reasonOf('authorizationDenied', { detail: `rejected by ${by}` })),
    );
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
