import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlock, GENESIS } from '../src/core/block';
import { generateKeyPair, sign, TrustStore } from '../src/crypto/ed25519';
import { LedgerStore } from '../src/storage/ledger';
import { catchUp } from '../src/sync/catchup';
import { GossipNode } from '../src/sync/gossip';
import {
  encodeBlockBroadcast,
  encodeBlockReject,
  encodeBlockRequest,
  encodeBlockResponse,
  encodeChainSummary,
  parseEnvelope,
  serializeEnvelope,
} from '../src/sync/messages';
import type { Block, MemoryChange } from '../src/types/block';
import type { BlockRejectPayload, Envelope } from '../src/types/protocol';

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
  const dir = await mkdtemp(join(tmpdir(), 'amm-sync-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('sync messages', () => {
  it('round-trips all core message types losslessly', () => {
    const block = buildBlock([makeChange('c1', 1)], GENESIS, 'dev', 1000);
    const messages: Envelope<unknown>[] = [
      encodeBlockBroadcast(block, 'a', 'b'),
      encodeBlockRequest(1, 'a', 'b', 3),
      encodeBlockResponse([block], 'a', 'b'),
      encodeChainSummary({ tip_index: 1, tip_hash: block.hash, group: 'g' }, 'a', 'b'),
      encodeBlockReject(
        { index: 1, hash: block.hash, reason: 'E_BAD_HASH' },
        'a',
        'b',
      ),
    ];

    for (const message of messages) {
      expect(parseEnvelope(serializeEnvelope(message))).toEqual(message);
    }
  });
});

describe('gossip', () => {
  it('dedups relay by block.hash', async () => {
    const relayed: string[] = [];
    const node = new GossipNode(async (to) => {
      relayed.push(to);
    }, 'leader');

    const block = buildBlock([makeChange('c1', 1)], GENESIS, 'leader', 1000);
    await node.broadcastBlock(block, ['d1', 'd2', 'leader']);
    await node.broadcastBlock(block, ['d1', 'd2', 'leader']); // 同一块不重复转发。

    expect(relayed).toEqual(['d1', 'd2']);
  });
});

describe('catchup', () => {
  it('catches up block-by-block and converges to the peer tip', async () => {
    const dir = await tempDir();
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);
    const ledger = new LedgerStore(dir, 'team-a');

    // 对端链：blocks 1..3（签名合法）。
    const peerBlocks: Block[] = [];
    let tip: Block = structuredClone(GENESIS);
    for (let i = 1; i <= 3; i++) {
      const block = buildBlock([makeChange(`c${i}`, i)], tip, 'leader', 1000 + i);
      block.signature = sign(kp.privateKey, block.hash);
      peerBlocks.push(block);
      tip = block;
    }

    const fetch = async (fromIndex: number) =>
      peerBlocks.filter((b) => b.index >= fromIndex);

    const result = await catchUp(
      structuredClone(GENESIS),
      { tip_index: 3, tip_hash: tip.hash, group: 'team-a' },
      fetch,
      ledger,
      store,
    );

    expect(result.ok).toBe(true);
    expect(result.added).toBe(3);
    expect(result.tip.index).toBe(3);
    expect(result.tip.hash).toBe(tip.hash);
    expect((await ledger.tip()).index).toBe(3);
  });

  it('rejects an invalid block without appending', async () => {
    const dir = await tempDir();
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);
    const ledger = new LedgerStore(dir, 'team-a');

    const b1 = buildBlock([makeChange('c1', 1)], structuredClone(GENESIS), 'leader', 1001);
    b1.signature = sign(kp.privateKey, b1.hash);

    // 篡改 hash（签名也随之失效）。
    const bad = { ...b1, hash: '0'.repeat(64) };

    const rejected: BlockRejectPayload[] = [];
    const result = await catchUp(
      structuredClone(GENESIS),
      { tip_index: 1, tip_hash: b1.hash, group: 'team-a' },
      async () => [bad],
      ledger,
      store,
      (reject) => {
        rejected.push(reject);
      },
    );

    expect(result.ok).toBe(false);
    expect(result.added).toBe(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.index).toBe(1);
    expect(rejected[0]!.reason).toBe('E_BAD_HASH');
    expect((await ledger.tip()).index).toBe(0);
  });
});
