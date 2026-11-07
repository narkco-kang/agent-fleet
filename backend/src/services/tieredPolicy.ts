import { key, reasonJson, reasonOf, type ActionKind, type PolicyTier } from '@agentfleet/shared';

/**
 * 权限目录（P2-3，tiered_policy）：每个对外动作映射到 allow / ask / deny 三档。
 *
 * 接入 actionGuard.request()：
 *   - allow：自动放行（跳过人工确认，仍留审计）
 *   - ask：  需人工确认（默认档）
 *   - deny： 自动拒绝（直接拦截，不执行）
 *
 * DSH 融合（docs/29）：**策略版本化 + 变更送达在途单，但不撤销既有 Mandate**。
 *   - version() = key('policy-v1', 当前档位快照)，内容派生 → 相同策略必得相同版本
 *   - setTier 变更版本后通过 onChange 通知（core 不直接做 I/O，由 index.ts 注入 adapter）
 *   - 在途确认单只写 policy_notice，仍按受理时的版本执行；confirm 时再做 revalidate
 */

const DEFAULTS: Record<ActionKind, PolicyTier> = {
  deploy: 'ask',
  uninstall: 'ask',
  asset_deliver: 'ask',
  loop_start: 'ask',
};

export interface PolicyChange {
  from: string;
  to: string;
  kind: ActionKind;
  /** 结构化原因，直接可落 policy_notice */
  noticeJson: string;
}

type PolicyChangeListener = (change: PolicyChange) => void;

class TieredPolicy {
  private tiers: Record<ActionKind, PolicyTier> = { ...DEFAULTS };
  private listeners: PolicyChangeListener[] = [];

  /** 取某动作的档位（未配置回退 ask） */
  getTier(kind: ActionKind): PolicyTier {
    return this.tiers[kind] ?? 'ask';
  }

  /** 内容派生的策略版本（DSH policyVersion 哈希） */
  version(): string {
    return key('policy-v1', this.all());
  }

  /** 注入策略变更 adapter（保持 core 无 I/O） */
  onChange(listener: PolicyChangeListener): void {
    this.listeners.push(listener);
  }

  /** 设置某动作的档位；版本变化则通知在途单 */
  setTier(kind: ActionKind, tier: PolicyTier): void {
    const from = this.version();
    this.tiers[kind] = tier;
    const to = this.version();
    if (from === to) return;
    const change: PolicyChange = {
      from,
      to,
      kind,
      noticeJson: reasonJson(reasonOf('policyChanged', { from, to, kind })),
    };
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        console.error('[tieredPolicy] 策略变更通知失败:', err);
      }
    }
  }

  /** 全部档位快照 */
  all(): Record<ActionKind, PolicyTier> {
    return { ...this.tiers };
  }

  /** 恢复默认（全 ask） */
  reset(): void {
    this.tiers = { ...DEFAULTS };
    this.listeners = [];
  }
}

/** 全局单例 */
export const tieredPolicy = new TieredPolicy();
