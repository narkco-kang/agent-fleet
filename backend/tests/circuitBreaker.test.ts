import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/services/circuitBreaker.js';

describe('CircuitBreaker 熔断器（P0-6）', () => {
  it('连续 N 次失败熔断，冷却窗口内 isOpen=true', () => {
    const cb = new CircuitBreaker(3, 60_000);
    expect(cb.recordFailure('dev-1', 'grok')).toBe(false);
    expect(cb.recordFailure('dev-1', 'grok')).toBe(false);
    // 第 3 次失败触发熔断
    expect(cb.recordFailure('dev-1', 'grok')).toBe(true);
    expect(cb.isOpen('dev-1', 'grok')).toBe(true);
  });

  it('不同 device/agent 维度独立', () => {
    const cb = new CircuitBreaker(2, 60_000);
    cb.recordFailure('dev-1', 'grok');
    cb.recordFailure('dev-1', 'grok'); // dev-1:grok 熔断
    expect(cb.isOpen('dev-1', 'grok')).toBe(true);
    expect(cb.isOpen('dev-1', 'claude')).toBe(false);
    expect(cb.isOpen('dev-2', 'grok')).toBe(false);
  });

  it('冷却到期自动半开恢复', () => {
    const cb = new CircuitBreaker(1, 10); // 冷却 10ms
    cb.recordFailure('dev-1', 'grok');
    expect(cb.isOpen('dev-1', 'grok')).toBe(true);
    // 等冷却窗口过去
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.isOpen('dev-1', 'grok')).toBe(false); // 半开恢复
        resolve();
      }, 30);
    });
  });

  it('成功清零失败计数', () => {
    const cb = new CircuitBreaker(2, 60_000);
    cb.recordFailure('dev-1', 'grok');
    cb.recordSuccess('dev-1', 'grok'); // 清零
    cb.recordFailure('dev-1', 'grok'); // 重新计数，只有 1 次，未熔断
    expect(cb.isOpen('dev-1', 'grok')).toBe(false);
  });
});
