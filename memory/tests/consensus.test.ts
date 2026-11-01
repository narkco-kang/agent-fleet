import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENESIS } from '../src/core/block';
import { buildMerkleRoot } from '../src/core/merkle';
import { generateKeyPair, verify } from '../src/crypto/ed25519';
import { Mempool } from '../src/consensus/mempool';
import { BlockProducer } from '../src/consensus/producer';
import { LedgerStore } from '../src/storage/ledger';
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

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'amm-cons-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('mempool', () => {
  it('dedups by change.id and drains in FIFO order', () => {
    const mempool = new Mempool();
    const c1 = makeChange('c1', 1);
    expect(mempool.add(c1)).toBe(true);
    expect(mempool.add(c1)).toBe(false); // 幂等去重。
    expect(mempool.add(makeChange('c2', 2))).toBe(true);
    expect(mempool.size()).toBe(2);

    const drained = mempool.drain(1);
    expect(drained).toEqual([c1]);
    expect(mempool.size()).toBe(1);
    expect(mempool.has('c1')).toBe(false);
  });
});

describe('BlockProducer', () => {
  it('buildBlock produces a verifiable signed block', () => {
    const kp = generateKeyPair();
    const producer = new BlockProducer(
      new LedgerStore('unused-dir'),
      new Mempool(),
      { author: 'leader', privateKey: kp.privateKey },
    );
    const changes = [makeChange('c1', 1)];
    const block = producer.buildBlock(changes, GENESIS);

    expect(block.index).toBe(1);
    expect(block.prev_hash).toBe(GENESIS.hash);
    expect(block.author).toBe('leader');
    expect(block.merkle_root).toBe(buildMerkleRoot(changes));
    expect(verify(kp.publicKey, block.hash, block.signature)).toBe(true);
  });

  it('produces a block once N changes accumulate', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const mempool = new Mempool();
    const kp = generateKeyPair();
    const producer = new BlockProducer(ledger, mempool, {
      author: 'leader',
      privateKey: kp.privateKey,
    }, { maxChangesPerBlock: 3, maxWaitMs: 5000 });

    for (let i = 1; i <= 3; i++) mempool.add(makeChange(`c${i}`, i));

    const block = await producer.produceOnce();
    expect(block).not.toBeNull();
    expect(block!.changes).toHaveLength(3);
    expect(block!.index).toBe(1);
    expect(block!.prev_hash).toBe(GENESIS.hash);
    expect(block!.merkle_root).toBe(buildMerkleRoot(block!.changes));
    expect(verify(kp.publicKey, block!.hash, block!.signature)).toBe(true);
    expect((await ledger.tip()).index).toBe(1);
  });

  it('produces a block when T elapses with partial changes', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const mempool = new Mempool();
    const kp = generateKeyPair();
    const producer = new BlockProducer(ledger, mempool, {
      author: 'leader',
      privateKey: kp.privateKey,
    }, { maxChangesPerBlock: 10, maxWaitMs: 40 });

    mempool.add(makeChange('c1', 1));

    const block = await producer.produceOnce();
    expect(block).not.toBeNull();
    expect(block!.changes).toHaveLength(1);
  });

  it('does not produce a block when the mempool stays empty', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const mempool = new Mempool();
    const kp = generateKeyPair();
    const producer = new BlockProducer(ledger, mempool, {
      author: 'leader',
      privateKey: kp.privateKey,
    }, { maxChangesPerBlock: 3, maxWaitMs: 40 });

    const block = await producer.produceOnce();
    expect(block).toBeNull();
    expect((await ledger.tip()).index).toBe(0);
  });
});
