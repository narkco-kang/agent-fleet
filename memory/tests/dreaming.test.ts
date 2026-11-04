import { describe, expect, it } from 'vitest';
import { DreamEngine } from '../src/semantic/dreaming.js';
import type { MemoryChange } from '../src/types/block.js';

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

describe('Dreaming 自演化（P1-2）', () => {
  it('筛候选 + 抽取 + 写回语义索引', () => {
    const eng = new DreamEngine();
    const r = eng.dream([
      change({ id: 'a', note: 'codex@dev-1 「写接口」 → ok', status: 'completed' }),
      change({ id: 'b', note: '用户偏好 React' }),
      change({ id: 'c', note: '结论：kilo-free 直连 200' }),
      change({ id: 'diag', target: 'diag:1', note: '诊断记录，应被过滤' }),
    ]);
    expect(r.selected).toBe(3); // diag 被筛掉
    expect(r.newFacts).toBe(3);
    expect(eng.size()).toBe(3);
  });

  it('幂等：同批 change 重复 dream 不产生重复事实', () => {
    const eng = new DreamEngine();
    const changes = [
      change({ id: 'a', note: 'codex@dev-1 「写接口」 → ok', status: 'completed' }),
      change({ id: 'b', note: '用户偏好 React' }),
    ];
    eng.dream(changes);
    const first = eng.size();
    const r2 = eng.dream(changes);
    expect(r2.newFacts).toBe(0); // 第二次不新增
    expect(eng.size()).toBe(first);
  });

  it('冲突消解：同一主谓新宾语覆盖旧事实', () => {
    const eng = new DreamEngine();
    // 同一 subject+predicate（codex@dev-1 / completed），不同 object
    eng.dream([change({ id: 'a', note: 'codex@dev-1 「任务A」 → 结果1', status: 'completed' })]);
    const r2 = eng.dream([change({ id: 'a2', note: 'codex@dev-1 「任务A」 → 结果2', status: 'completed' })]);
    expect(r2.updatedFacts).toBe(1);
    expect(eng.size()).toBe(1); // 合并后仍只有一条
    const f = eng.all()[0]!;
    expect(f.object).toContain('结果2'); // 新事实胜旧
  });

  it('busy-retreat：置 busy 时 dream 立即撤退不写入', () => {
    const eng = new DreamEngine();
    eng.setBusy(true);
    const r = eng.dream([change({ id: 'x', note: 'codex@dev 「任务」 → ok', status: 'completed' })]);
    expect(r.retreated).toBe(true);
    expect(r.newFacts).toBe(0);
    expect(eng.size()).toBe(0);
    eng.setBusy(false);
    const r2 = eng.dream([change({ id: 'x', note: 'codex@dev 「任务」 → ok', status: 'completed' })]);
    expect(r2.retreated).toBe(false);
    expect(eng.size()).toBe(1);
  });
});
