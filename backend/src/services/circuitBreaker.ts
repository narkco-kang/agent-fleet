/**
 * 熔断器（P0-6）：device + agent 维度失败计数，连续 N 次失败熔断（冷却窗口内不派发），
 * 冷却到期自动半开（下一次成功即关闭）。对齐认领粒度，避免熔断误杀健康 agent。
 */

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const DEFAULT_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  constructor(
    private readonly threshold = DEFAULT_THRESHOLD,
    private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
  ) {}

  private key(deviceId: string, agentType: string): string {
    return `${deviceId}:${agentType}`;
  }

  /** 记录一次失败，返回是否触发熔断（达到阈值） */
  recordFailure(deviceId: string, agentType: string): boolean {
    const k = this.key(deviceId, agentType);
    const s = this.states.get(k) ?? { failures: 0, openedAt: null };
    s.failures += 1;
    if (s.failures >= this.threshold && s.openedAt === null) {
      s.openedAt = Date.now();
      this.states.set(k, s);
      return true;
    }
    this.states.set(k, s);
    return false;
  }

  /** 成功清零 */
  recordSuccess(deviceId: string, agentType: string): void {
    this.states.delete(this.key(deviceId, agentType));
  }

  /** 是否熔断中（冷却窗口内为 true；冷却到期自动半开恢复） */
  isOpen(deviceId: string, agentType: string): boolean {
    const k = this.key(deviceId, agentType);
    const s = this.states.get(k);
    if (!s || s.openedAt === null) return false;
    if (Date.now() - s.openedAt >= this.cooldownMs) {
      // 冷却到期 → 半开（自动恢复，等下一次成功清零）
      this.states.delete(k);
      return false;
    }
    return true;
  }

  /** 手动重置 */
  reset(deviceId: string, agentType: string): void {
    this.states.delete(this.key(deviceId, agentType));
  }

  /** 当前熔断数（诊断） */
  openCount(): number {
    return Array.from(this.states.values()).filter((s) => s.openedAt !== null).length;
  }
}

/** 全局单例 */
export const circuitBreaker = new CircuitBreaker();
