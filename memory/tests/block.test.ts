import { describe, expect, it } from 'vitest';
import { buildBlock, computeHash, GENESIS } from '../src/core/block';
import { buildMerkleRoot } from '../src/core/merkle';
import { sha256Hex } from '../src/crypto/hash';
import type { MemoryChange } from '../src/types/block';

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

describe('block', () => {
  it('GENESIS is a deterministic constant', () => {
    expect(GENESIS.index).toBe(0);
    expect(GENESIS.prev_hash).toBe('0'.repeat(64));
    expect(GENESIS.timestamp).toBe(0);
    expect(GENESIS.author).toBe('genesis');
    expect(GENESIS.signature).toBe('');
    expect(GENESIS.changes).toEqual([]);
    expect(GENESIS.merkle_root).toBe(sha256Hex(''));
    // 硬编码断言，防止常量漂移。
    expect(GENESIS.hash).toBe(
      '295d2f27eafea7102c3f0ad1dd7aa6701b1eb65060c84707345be486e7e09959',
    );
  });

  it('computeHash matches the hash field', () => {
    expect(computeHash(GENESIS)).toBe(GENESIS.hash);
  });

  it('changes any header field and the hash changes', () => {
    const block = buildBlock([makeChange('c1', 1)], GENESIS, 'device-a', 1000);
    const original = block.hash;

    expect(computeHash({ ...block, timestamp: 1001 })).not.toBe(original);
    expect(computeHash({ ...block, author: 'device-b' })).not.toBe(original);
    expect(computeHash({ ...block, changes: [] })).not.toBe(original);
    expect(
      computeHash({ ...block, changes: [makeChange('c1', 1), makeChange('c2', 2)] }),
    ).not.toBe(original);
  });

  it('buildBlock sets index/prev_hash/merkle_root/hash correctly', () => {
    const changes = [makeChange('c1', 1), makeChange('c2', 2)];
    const block = buildBlock(changes, GENESIS, 'device-a', 2000);

    expect(block.index).toBe(1);
    expect(block.prev_hash).toBe(GENESIS.hash);
    expect(block.author).toBe('device-a');
    expect(block.merkle_root).toBe(buildMerkleRoot(changes));
    expect(block.hash).toBe(computeHash(block));
    expect(block.signature).toBe('');
  });
});
