import { describe, expect, it } from 'vitest';
import {
  classifyChange,
  extractFact,
  semanticDistribution,
  type SemanticCategory,
} from '../src/semantic/extractor.js';
import type { MemoryChange } from '../src/types/block.js';

/**
 * P1-1 五类语义记忆分层：纯规则分类 + 结构化事实抽取。
 */
function change(over: Partial<MemoryChange>): MemoryChange {
  return {
    id: over.id ?? 'c-1',
    op: over.op ?? 'set_status',
    target: over.target ?? 'task:1',
    by: 'coordinator',
    at: new Date().toISOString(),
    rev: 1,
    note: over.note ?? '',
    status: over.status,
    ...over,
  };
}

describe('语义记忆分层（P1-1）', () => {
  it('五类各自正确分类', () => {
    expect(classifyChange(change({ note: 'codex@dev-1 「写登录接口」 → 完成', status: 'completed' }))).toBe(
      'episodic',
    );
    expect(classifyChange(change({ note: '用户偏好 React + TypeScript' }))).toBe('profile');
    expect(classifyChange(change({ note: '结论：该 API 返回 JSON，需带 Bearer' }))).toBe('semantic');
    expect(classifyChange(change({ note: '剩余额度 3 次，token 余额 1200' }))).toBe('variable');
    expect(classifyChange(change({ note: '会话摘要：完成了部署并修复了 3 个 bug' }))).toBe('summary');
  });

  it('覆盖率 ≥ 80%（代表性语料分类准确率）', () => {
    const corpus: Array<{ note: string; status?: string; expect: SemanticCategory }> = [
      { note: 'codex@dev-1 「写接口」 → OK', status: 'completed', expect: 'episodic' },
      { note: 'claude@dev-2 「审代码」 → 通过', status: 'completed', expect: 'episodic' },
      { note: 'grok@dev-3 「调研竞品」 → 失败', status: 'failed', expect: 'episodic' },
      { note: '用户偏好用中文交流', expect: 'profile' },
      { note: '习惯：每天早会先看队列', expect: 'profile' },
      { note: '规则：部署前必须过 actionGuard', expect: 'semantic' },
      { note: '结论：kilo-free 直连 200 可用', expect: 'semantic' },
      { note: '架构：调度用 claimAgent 限流', expect: 'semantic' },
      { note: '配置：MODELGATEWAY_PORT=18765', expect: 'variable' },
      { note: '统计：本日已完成 12 个任务', expect: 'variable' },
      { note: '摘要：本轮完成 Loop 编排优化', expect: 'summary' },
      { note: '交接：下一任务需注入前序摘要', expect: 'summary' },
    ];
    let hit = 0;
    for (const c of corpus) {
      if (classifyChange(change({ note: c.note, status: c.status })) === c.expect) hit += 1;
    }
    const rate = hit / corpus.length;
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });

  it('extractFact 抽取任务事件主谓宾', () => {
    const f = extractFact(
      change({ id: 'c-x', note: 'codex@dev-1 「写登录接口」 → 返回 200', status: 'completed' }),
    );
    expect(f.category).toBe('episodic');
    expect(f.subject).toBe('codex@dev-1');
    expect(f.predicate).toBe('completed');
    expect(f.object).toContain('200');
    expect(f.sourceId).toBe('c-x');
  });

  it('semanticDistribution 统计分类 + 覆盖率 100%', () => {
    const changes = [
      change({ note: 'codex@dev-1 「a」 → ok', status: 'completed' }),
      change({ note: 'codex@dev-2 「b」 → ok', status: 'completed' }),
      change({ note: '用户偏好 React' }),
      change({ note: '结论：X 会返回 Y' }),
    ];
    const d = semanticDistribution(changes);
    expect(d.coverage).toBe(1);
    expect(d.byCategory.episodic).toBe(2);
    expect(d.byCategory.profile).toBe(1);
    expect(d.byCategory.semantic).toBe(1);
    expect(d.facts).toHaveLength(4);
  });
});
