import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/crypto/hash';
import {
  buildMerkleRoot,
  leafHash,
  makeProof,
  verifyProof,
} from '../src/core/merkle';
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

describe('merkle', () => {
  it('empty tree root equals sha256Hex("")', () => {
    expect(buildMerkleRoot([])).toBe(sha256Hex(''));
  });

  it('builds a root for odd leaf count and verifies every proof', () => {
    const changes = [makeChange('c1', 1), makeChange('c2', 2), makeChange('c3', 3)];
    const root = buildMerkleRoot(changes);

    for (let i = 0; i < changes.length; i++) {
      const proof = makeProof(changes, i);
      expect(proof.root).toBe(root);
      expect(proof.leaf_index).toBe(i);
      expect(verifyProof(proof)).toBe(true);
    }
  });

  it('builds a root for even leaf count and verifies a proof', () => {
    const changes = [
      makeChange('c1', 1),
      makeChange('c2', 2),
      makeChange('c3', 3),
      makeChange('c4', 4),
    ];
    const proof = makeProof(changes, 1);
    expect(proof.root).toBe(buildMerkleRoot(changes));
    expect(verifyProof(proof)).toBe(true);
  });

  it('fails a proof whose leaf was tampered', () => {
    const changes = [makeChange('c1', 1), makeChange('c2', 2), makeChange('c3', 3)];
    const proof = makeProof(changes, 0);
    const tampered = {
      ...proof,
      leaf_hash: leafHash({ ...changes[0]!, note: 'tampered' }),
    };
    expect(verifyProof(tampered)).toBe(false);
  });

  it('fails a proof against a different root', () => {
    const changes = [makeChange('c1', 1), makeChange('c2', 2)];
    const proof = makeProof(changes, 0);
    expect(verifyProof({ ...proof, root: '0'.repeat(64) })).toBe(false);
  });

  it('throws on out-of-range or empty proof requests', () => {
    expect(() => makeProof([makeChange('c1', 1)], 5)).toThrow();
    expect(() => makeProof([], 0)).toThrow();
  });
});
