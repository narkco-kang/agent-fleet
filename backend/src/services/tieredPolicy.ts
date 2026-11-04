import type { ActionKind, PolicyTier } from '@agentfleet/shared';

/**
 * 权限目录（P2-3，tiered_policy）：每个对外动作映射到 allow / ask / deny 三档。
 *
 * 接入 actionGuard.request()：
 *   - allow：自动放行（跳过人工确认，仍留审计）
 *   - ask：  需人工确认（默认档）
 *   - deny： 自动拒绝（直接拦截，不执行）
 *
 * 默认全 ask（保守安全）；运行时可通过 API 调整，进程内生效。
 */

const DEFAULTS: Record<ActionKind, PolicyTier> = {
  deploy: 'ask',
  uninstall: 'ask',
  asset_deliver: 'ask',
  loop_start: 'ask',
};

class TieredPolicy {
  private tiers: Record<ActionKind, PolicyTier> = { ...DEFAULTS };

  /** 取某动作的档位（未配置回退 ask） */
  getTier(kind: ActionKind): PolicyTier {
    return this.tiers[kind] ?? 'ask';
  }

  /** 设置某动作的档位 */
  setTier(kind: ActionKind, tier: PolicyTier): void {
    this.tiers[kind] = tier;
  }

  /** 全部档位快照 */
  all(): Record<ActionKind, PolicyTier> {
    return { ...this.tiers };
  }

  /** 恢复默认（全 ask） */
  reset(): void {
    this.tiers = { ...DEFAULTS };
  }
}

/** 全局单例 */
export const tieredPolicy = new TieredPolicy();
