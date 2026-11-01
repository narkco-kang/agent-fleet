import { describe, expect, it } from 'vitest';
import { buildBlock, computeHash, GENESIS } from '../src/core/block';
import { buildMerkleRoot } from '../src/core/merkle';
import { generateKeyPair, sign, TrustStore } from '../src/crypto/ed25519';
import { detectTamper } from '../src/validation/tamper';
import {
  verifyBlock,
  verifyChain,
  verifySignature,
} from '../src/validation/verifier';
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

function signedBlock(
  changes: MemoryChange[],
  tip: Block,
  author: string,
  keyPair: { publicKey: string; privateKey: string },
  ts = 1000,
): Block {
  const block = buildBlock(changes, tip, author, ts);
  block.signature = sign(keyPair.privateKey, block.hash);
  return block;
}

describe('verifier', () => {
  it('accepts a valid signed block', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);

    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'device-a', kp);
    expect(verifyBlock(block, GENESIS, store).ok).toBe(true);
  });

  it('returns E_CHAIN_BREAK on prev_hash mismatch', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);
    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'device-a', kp);

    const bad = { ...block, prev_hash: '0'.repeat(64) };
    const result = verifyBlock(bad, GENESIS, store);
    expect(result.code).toBe('E_CHAIN_BREAK');
  });

  it('returns E_BAD_HASH on hash mismatch', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);
    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'device-a', kp);

    const bad = { ...block, hash: '0'.repeat(64) };
    expect(verifyBlock(bad, GENESIS, store).code).toBe('E_BAD_HASH');
  });

  it('returns E_BAD_MERKLE on merkle_root mismatch', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);
    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'device-a', kp);

    // 篡改 merkle_root 并重算 hash 使 hash 自洽，但 merkle 与 changes 不符。
    const bad: Block = { ...block, merkle_root: '0'.repeat(64), hash: '' };
    bad.hash = computeHash(bad);
    bad.signature = sign(kp.privateKey, bad.hash);
    expect(verifyBlock(bad, GENESIS, store).code).toBe('E_BAD_MERKLE');
  });

  it('returns E_BAD_SIG for a forged signature', () => {
    const kp = generateKeyPair();
    const attacker = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);
    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'device-a', kp);

    const bad = { ...block, signature: sign(attacker.privateKey, block.hash) };
    expect(verifyBlock(bad, GENESIS, store).code).toBe('E_BAD_SIG');
  });

  it('returns E_BAD_SIG for an untrusted author', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey); // 登记的是别人。

    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'unknown', kp);
    expect(verifyBlock(block, GENESIS, store).code).toBe('E_BAD_SIG');
  });

  it('special-cases the genesis signature', () => {
    expect(verifySignature(GENESIS, new TrustStore())).toBe(true);
  });

  it('verifyChain passes a signed chain and flags a bad signature', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);

    const blocks: Block[] = [structuredClone(GENESIS)];
    let tip = blocks[0]!;
    for (let i = 1; i <= 3; i++) {
      const block = signedBlock([makeChange(`c${i}`, i)], tip, 'device-a', kp, 1000 + i);
      blocks.push(block);
      tip = block;
    }

    expect(verifyChain(blocks, store).ok).toBe(true);

    const attacker = generateKeyPair();
    blocks[2] = {
      ...blocks[2]!,
      signature: sign(attacker.privateKey, blocks[2]!.hash),
    };
    const report = verifyChain(blocks, store);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some((e) => e.code === 'E_BAD_SIG' && e.index === 2),
    ).toBe(true);
  });

  it('detectTamper localizes a tampered change to its block index', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);

    const blocks: Block[] = [structuredClone(GENESIS)];
    let tip = blocks[0]!;
    for (let i = 1; i <= 5; i++) {
      const block = signedBlock([makeChange(`c${i}`, i)], tip, 'device-a', kp, 1000 + i);
      blocks.push(block);
      tip = block;
    }

    // 篡改第 3 块的 change 内容（不重算 hash/merkle）。
    blocks[3] = {
      ...blocks[3]!,
      changes: [{ ...blocks[3]!.changes[0]!, note: 'tampered' }],
    };

    const report = detectTamper(blocks, store);
    expect(report.ok).toBe(false);
    const types = report.tampered
      .filter((f) => f.index === 3)
      .map((f) => f.type);
    expect(types).toContain('hash');
    expect(types).toContain('merkle');
  });

  it('detectTamper flags a forged signature', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('device-a', kp.publicKey);

    const block = signedBlock([makeChange('c1', 1)], GENESIS, 'device-a', kp);
    const attacker = generateKeyPair();
    const forged = { ...block, signature: sign(attacker.privateKey, block.hash) };

    const report = detectTamper([structuredClone(GENESIS), forged], store);
    expect(report.tampered.some((f) => f.index === 1 && f.type === 'signature')).toBe(
      true,
    );
  });
});
