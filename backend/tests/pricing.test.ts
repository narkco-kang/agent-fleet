import { describe, expect, it } from 'vitest';
import { estimateCostUsd, MODEL_PRICING_USD } from '@agentfleet/shared';

/**
 * P1-7 成本核算：模型价格表 + 成本估算。
 */
describe('成本核算（P1-7）', () => {
  it('精确匹配模型价格', () => {
    expect(MODEL_PRICING_USD['gpt-4o']).toBeDefined();
    expect(MODEL_PRICING_USD['deepseek-chat'].inputPerM).toBeGreaterThan(0);
  });

  it('按 token 数估算成本：1M in + 1M out', () => {
    // gpt-4o: in 2.5 / out 10 USD per 1M
    const cost = estimateCostUsd('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12.5, 5);
  });

  it('模型名带版本后缀也能命中（前缀包含兜底）', () => {
    const cost = estimateCostUsd('gpt-4o-2024-08-06', 1_000_000, 0);
    expect(cost).toBeCloseTo(2.5, 5);
  });

  it('未知模型 / 免费源估值为 0', () => {
    expect(estimateCostUsd('kilo-auto/free', 1000, 1000)).toBe(0);
    expect(estimateCostUsd('no-such-model', 1000, 1000)).toBe(0);
    expect(estimateCostUsd(null, 1000, 1000)).toBe(0);
  });
});
