import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/search/tokenize';
import { Bm25Index } from '../src/search/bm25';
import { scrubSecrets, hasSecret } from '../src/search/scrub';
import { jaccard, findSimilar } from '../src/search/similarity';
import { MemorySearchIndex, changeText } from '../src/search/memory-index';
import type { MemoryChange } from '../src/types/block';

function change(id: string, note: string): MemoryChange {
  return {
    id,
    op: 'set_status',
    target: `task:${id}`,
    by: 'coordinator',
    at: new Date().toISOString(),
    rev: 1,
    note,
    status: 'completed',
  };
}

describe('tokenize', () => {
  it('splits english words lowercased', () => {
    const t = tokenize('Fix Login Timeout bug');
    expect(t).toContain('fix');
    expect(t).toContain('login');
    expect(t).toContain('timeout');
  });

  it('splits chinese into unigram + bigram', () => {
    const t = tokenize('登录超时');
    expect(t).toContain('登');
    expect(t).toContain('录');
    expect(t).toContain('登录'); // bigram 覆盖常用双字词
    expect(t).toContain('超时');
  });

  it('returns empty for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('Bm25Index', () => {
  it('ranks relevant docs above irrelevant', () => {
    const idx = new Bm25Index();
    idx.add('a', tokenize('修复登录超时的 bug 登录超时登录超时'));
    idx.add('b', tokenize('生成季度营收图表'));
    const hits = idx.search(tokenize('登录超时'), 10);
    expect(hits[0]?.id).toBe('a');
  });

  it('remove drops a doc from results', () => {
    const idx = new Bm25Index();
    idx.add('a', tokenize('登录超时'));
    idx.add('b', tokenize('登录超时'));
    idx.remove('a');
    const hits = idx.search(tokenize('登录超时'), 10);
    expect(hits.map((h) => h.id)).toEqual(['b']);
  });

  it('add is idempotent (same id overwrites)', () => {
    const idx = new Bm25Index();
    idx.add('a', tokenize('foo'));
    idx.add('a', tokenize('bar'));
    expect(idx.size()).toBe(1);
    const hits = idx.search(tokenize('bar'), 10);
    expect(hits[0]?.id).toBe('a');
  });
});

describe('scrubSecrets', () => {
  it('redacts openai-style keys', () => {
    const out = scrubSecrets('key=sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(out).not.toContain('sk-abcdefghij');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts bearer tokens', () => {
    const out = scrubSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6');
    expect(out).not.toContain('eyJhbGci');
    expect(out).toContain('[REDACTED]');
  });

  it('hasSecret detects keys', () => {
    expect(hasSecret('sk-abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
    expect(hasSecret('just a normal note')).toBe(false);
  });
});

describe('MemorySearchIndex', () => {
  it('changeText aggregates note + target + node label', () => {
    const c = change('t1', '修复登录超时');
    c.node = { id: 'n1', type: 'task', label: '登录模块', status: 'done', source: 'grok', evidence: [] };
    const text = changeText(c);
    expect(text).toContain('修复登录超时');
    expect(text).toContain('登录模块');
  });

  it('recalls by keyword', () => {
    const idx = new MemorySearchIndex();
    idx.add(change('t1', '修复登录超时的 bug'));
    idx.add(change('t2', '生成季度营收图表'));
    const hits = idx.search('登录超时', 10);
    expect(hits[0]?.change.id).toBe('t1');
  });

  it('findSimilar detects near-duplicates', () => {
    const idx = new MemorySearchIndex();
    idx.add(change('t1', '修复登录超时的 bug'));
    idx.add(change('t2', '生成季度营收图表'));
    const similar = idx.findSimilar('修复登录超时的问题', 0.6, 5);
    expect(similar[0]?.item.id).toBe('t1');
  });

  it('hybridSearch fuses BM25 + similarity (RRF)', () => {
    const idx = new MemorySearchIndex();
    // t2 与 query 措辞不同但字符高度相似（只有 token 级差异）
    idx.add(change('t1', '登录超时登录超时登录超时'));
    idx.add(change('t2', '修复登录超时的问题'));
    idx.add(change('t3', '生成季度营收图表'));
    const hits = idx.hybridSearch('修复登录超时', 10);
    // t2（相似）应排在 t3（无关）之前
    const ids = hits.map((h) => h.change.id);
    expect(ids.indexOf('t2')).toBeLessThan(ids.indexOf('t3'));
  });
});

describe('similarity', () => {
  it('jaccard scores identical text high', () => {
    expect(jaccard('修复登录超时', '修复登录超时')).toBeGreaterThan(0.9);
  });

  it('jaccard scores unrelated text low', () => {
    expect(jaccard('修复登录超时', '生成季度营收')).toBeLessThan(0.3);
  });

  it('findSimilar filters by threshold', () => {
    const hits = findSimilar(
      '修复登录超时',
      [
        { item: 1, text: '修复登录超时的 bug' },
        { item: 2, text: '生成季度营收图表' },
      ],
      0.5,
    );
    expect(hits.map((h) => h.item)).toEqual([1]);
  });
});
