import { describe, expect, it } from 'vitest';
import { buildBlock, GENESIS } from '../src/core/block';
import {
  chooseMainChain,
  isMainChain,
  selectFork,
} from '../src/consensus/fork';
import type { Block, MemoryChange } from '../src/types/block';

function makeChange(id: string, rev: number): MemoryChange {
  return {
    id,
    op: 'add_node',
    target: `node-${id}`,
    by: 'tester',
    at: '2026-01-01T00:00:00+00:00',
    rev,
    note: '',
  };
}

function makeChain(n: number, author: string, start: number): Block[] {
  const blocks: Block[] = [structuredClone(GENESIS)];
  let tip = blocks[0]!;
  for (let i = 1; i <= n; i++) {
    const block = buildBlock([makeChange(`c${i}`, i)], tip, author, start + i);
    blocks.push(block);
    tip = block;
  }
  return blocks;
}

describe('fork', () => {
  it('selects the longest chain', () => {
    const longChain = makeChain(5, 'device-a', 1000); // length 6
    const shortChain = makeChain(3, 'device-b', 2000); // length 4

    expect(chooseMainChain([shortChain, longChain])).toBe(longChain);
    expect(chooseMainChain([longChain, shortChain]).length).toBe(6);
  });

  it('breaks ties by lexicographic min hash at the divergence index', () => {
    const a = makeChain(4, 'device-a', 1000);
    const b = makeChain(4, 'device-b', 2000);
    // 两者等长，从 index 1 起分叉。
    const divIdx = 1;
    const expected = a[divIdx]!.hash < b[divIdx]!.hash ? a : b;

    const main = chooseMainChain([a, b]);
    expect(main).toBe(expected);

    // 全网确定性一致（多次运行结果相同）。
    for (let i = 0; i < 5; i++) {
      expect(chooseMainChain([a, b])).toBe(expected);
    }
  });

  it('selectFork returns main + orphans without deleting data', () => {
    const main = makeChain(5, 'device-a', 1000);
    const orphan = makeChain(4, 'device-b', 2000);

    const result = selectFork([main, orphan]);
    expect(result.main).toBe(main);
    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]).toBe(orphan);
  });

  it('isMainChain identifies the chosen chain', () => {
    const a = makeChain(5, 'device-a', 1000);
    const b = makeChain(4, 'device-b', 2000);

    expect(isMainChain(a, [a, b])).toBe(true);
    expect(isMainChain(b, [a, b])).toBe(false);
  });
});
