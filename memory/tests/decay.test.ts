import { describe, expect, it } from 'vitest';
import { decayWeight, ageSince } from '../src/semantic/decay.js';
import { MemorySearchIndex } from '../src/search/memory-index.js';
import type { MemoryChange } from '../src/types/block.js';

/**
 * docs/25 遗忘衰减 + 访问加强：只作用于检索排序权重（旧记忆/少访问降权），不删账本。
 */

function mkChange(id: string, note: string, at: string): MemoryChange {
  return {
    id,
    op: 'set_status',
    target: `task:${id}`,
    by: 'coordinator',
    at,
    rev: 1,
    note,
    status: 'completed',
  };
}

describe('遗忘衰减（decayWeight）', () => {
  it('age=0 不衰减（权重 1）', () => {
    expect(decayWeight(0, 0)).toBe(1);
  });

  it('age=半衰期 权重降为 0.5', () => {
    const cfg = { halfLifeMs: 1000, accessBoost: 0.5 };
    expect(decayWeight(1000, 0, cfg)).toBeCloseTo(0.5);
  });

  it('访问加强：accessCount 越大权重越高', () => {
    const cfg = { halfLifeMs: 1000, accessBoost: 0.5 };
    expect(decayWeight(0, 10, cfg)).toBeGreaterThan(decayWeight(0, 0, cfg));
  });

  it('ageSince 计算毫秒差', () => {
    const now = Date.now();
    expect(ageSince(new Date(now - 5000).toISOString(), now)).toBe(5000);
  });

  it('无效时间戳 age=0（不衰减）', () => {
    expect(ageSince('not-a-date', 1000)).toBe(0);
  });
});

describe('MemorySearchIndex 遗忘衰减集成', () => {
  it('旧记忆比新记忆排序靠后（同文本，仅时间不同）', () => {
    const idx = new MemorySearchIndex();
    const now = Date.now();
    idx.add(mkChange('fresh', '登录接口实现', new Date(now).toISOString()));
    idx.add(mkChange('stale', '登录接口实现', new Date(now - 30 * 24 * 3600 * 1000).toISOString()));

    const hits = idx.search('登录接口', 10);
    expect(hits[0]?.change.id).toBe('fresh');
    expect(hits[1]?.change.id).toBe('stale');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('访问加强：重复检索后同记忆权重上升', () => {
    const idx = new MemorySearchIndex();
    idx.add(mkChange('a', '登录接口实现', new Date().toISOString()));

    const first = idx.search('登录', 1)[0]!;
    const second = idx.search('登录', 1)[0]!;
    expect(second.score).toBeGreaterThan(first.score);
  });

  it('调整半衰期后衰减强度变化', () => {
    const idx = new MemorySearchIndex();
    const now = Date.now();
    idx.add(mkChange('old', '登录接口', new Date(now - 10 * 24 * 3600 * 1000).toISOString()));

    const before = idx.search('登录', 1)[0]!;
    idx.setDecay({ halfLifeMs: 24 * 3600 * 1000 }); // 半衰期缩到 1 天 → 10 天前的记忆衰减更强
    const after = idx.search('登录', 1)[0]!;
    expect(after.score).toBeLessThan(before.score);
  });
});
