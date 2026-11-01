import { describe, expect, it } from 'vitest';
import { buildBlock, computeHash, GENESIS } from '../src/core/block';
import { isLinked, verifyChain } from '../src/core/chain';
import { buildMerkleRoot } from '../src/core/merkle';
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

function makeChain(n: number, author = 'device-a', start = 1000): Block[] {
  const blocks: Block[] = [structuredClone(GENESIS)];
  let tip = blocks[0]!;
  for (let i = 1; i <= n; i++) {
    const block = buildBlock([makeChange(`c${i}`, i)], tip, author, start + i);
    blocks.push(block);
    tip = block;
  }
  return blocks;
}

describe('chain', () => {
  it('accepts a valid linked chain', () => {
    const report = verifyChain(makeChain(6));
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('detects a tampered historical block via chain break at next index', () => {
    const blocks = makeChain(7);
    // 智能篡改：改 change 内容并重算 merkle_root 与 hash，使块自身自洽。
    const target = blocks[5]!;
    const tamperedChanges = [{ ...target.changes[0]!, note: 'tampered' }];
    const tampered: Block = {
      ...target,
      changes: tamperedChanges,
      merkle_root: buildMerkleRoot(tamperedChanges),
      hash: '',
    };
    tampered.hash = computeHash(tampered);
    blocks[5] = tampered;

    const report = verifyChain(blocks);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some(
        (e) => e.code === 'E_CHAIN_BREAK' && e.index === 6,
      ),
    ).toBe(true);
  });

  it('detects a tampered genesis', () => {
    const blocks = makeChain(2);
    const badGenesis: Block = { ...blocks[0]!, author: 'evil', hash: '' };
    badGenesis.hash = computeHash(badGenesis);
    blocks[0] = badGenesis;

    const report = verifyChain(blocks);
    expect(
      report.errors.some(
        (e) => e.code === 'E_BAD_GENESIS' && e.index === 0,
      ),
    ).toBe(true);
  });

  it('detects a non-monotonic index', () => {
    const blocks = makeChain(3);
    blocks[2] = { ...blocks[2]!, index: 99 };

    const report = verifyChain(blocks);
    expect(
      report.errors.some((e) => e.code === 'E_BAD_INDEX' && e.index === 2),
    ).toBe(true);
  });

  it('reports an empty chain as bad genesis', () => {
    const report = verifyChain([]);
    expect(report.ok).toBe(false);
    expect(report.errors[0]!.code).toBe('E_BAD_GENESIS');
  });

  it('isLinked checks prev_hash and index monotonicity', () => {
    const blocks = makeChain(1);
    expect(isLinked(blocks[0]!, blocks[1]!)).toBe(true);
    expect(isLinked(blocks[1]!, blocks[0]!)).toBe(false);
  });
});
