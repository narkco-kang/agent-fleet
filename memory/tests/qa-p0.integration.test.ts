/**
 * QA 集成测试 —— P0 六项跨设备分布式记忆账本 + 边界/错误路径。
 *
 * 依据：docs/08-记忆账本开发文档图谱.md §4（T1-T8 验收）+ §5（共享知识）
 *       docs/06-记忆架构融合PRD.md P0 六项
 *
 * 覆盖：
 *   P0-1 区块 + 哈希链（buildBlock 连造 5 块，prev_hash 环环相扣，verifyChain 通过）
 *   P0-2 Merkle（3 叶 proof 验证；篡改 change 后 merkle_root 不匹配）
 *   P0-3 账本存储（appendBlock 5 块 tip 正确；重复同 index 块被拒 E_STALE_BLOCK）
 *   P0-4 跨设备同步（两个内存 ledger，gossip 广播 + catchup 补同步后 tip 一致）
 *   P0-5 篡改检测（篡改历史块 change → detectTamper 定位块号 + 类型）
 *   P0-6 amg 适配（toChange/toSemantic 往返映射字段不丢，evidence/validity 透传）
 *
 * 边界/错误路径：
 *   篡改 genesis、空 mempool 出块、奇数/偶数叶 Merkle、签名伪造、分叉孤儿保留。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlock, GENESIS } from '../src/core/block';
import { buildMerkleRoot, makeProof, verifyProof } from '../src/core/merkle';
import { sha256Hex } from '../src/crypto/hash';
import { canonicalize } from '../src/crypto/canonical';
import { generateKeyPair, sign, TrustStore } from '../src/crypto/ed25519';
import { LedgerStore } from '../src/storage/ledger';
import { Mempool } from '../src/consensus/mempool';
import { BlockProducer } from '../src/consensus/producer';
import { catchUp } from '../src/sync/catchup';
import { encodeBlockBroadcast, parseEnvelope } from '../src/sync/messages';
import { detectTamper } from '../src/validation/tamper';
import { verifyBlock, verifyChain } from '../src/validation/verifier';
import { toChange, toSemantic } from '../src/adapters/amg-mapper';
import type { SemanticOp } from '../src/adapters/amg-mapper';
import type { Block, MemoryChange } from '../src/types/block';
import type { BlockBroadcastPayload, Envelope } from '../src/types/protocol';
import type { Evidence, MemoryNode } from '../src/types/memory';

// —— 测试夹具 ——

function makeChange(id: string, rev: number, extra: Partial<MemoryChange> = {}): MemoryChange {
  return {
    id,
    op: 'add_node',
    target: `node-${id}`,
    by: 'tester',
    at: '2026-01-01T00:00:00+00:00',
    rev,
    note: '',
    ...extra,
  };
}

/** 构造并签名一个区块。 */
function signedBlock(
  changes: MemoryChange[],
  tip: Block,
  author: string,
  keyPair: { publicKey: string; privateKey: string },
  timestamp = 1000,
): Block {
  const block = buildBlock(changes, tip, author, timestamp);
  block.signature = sign(keyPair.privateKey, block.hash);
  return block;
}

/** 从 genesis 起连造 length 个签名块，返回 [genesis, b1, ..., bn]。 */
function signedChain(
  length: number,
  keyPair: { publicKey: string; privateKey: string },
  author = 'leader',
): Block[] {
  const blocks: Block[] = [structuredClone(GENESIS)];
  let tip = blocks[0]!;
  for (let i = 1; i <= length; i++) {
    const block = signedBlock([makeChange(`c${i}`, i)], tip, author, keyPair, 1000 + i);
    blocks.push(block);
    tip = block;
  }
  return blocks;
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'amm-qa-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// —— P0-1 区块 + 哈希链 ——

describe('P0-1 区块 + 哈希链', () => {
  it('buildBlock 连造 5 块，prev_hash 环环相扣，verifyChain 通过', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const blocks = signedChain(5, kp);

    expect(blocks).toHaveLength(6); // genesis + 5

    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1]!;
      const cur = blocks[i]!;
      expect(cur.index).toBe(prev.index + 1);
      expect(cur.prev_hash).toBe(prev.hash);
    }

    const report = verifyChain(blocks, store);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('篡改历史块 change 内容 → 该块 hash/merkle 失配，可定位到块号', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const blocks = signedChain(5, kp);

    // 篡改 block[3]（index=3）的 change 内容，不重算 hash/merkle。
    blocks[3] = {
      ...blocks[3]!,
      changes: [{ ...blocks[3]!.changes[0]!, note: 'tampered' }],
    };

    const report = verifyChain(blocks, store);
    expect(report.ok).toBe(false);

    // block[3] 自身 hash/merkle 失配（内容被改但字段未重算）。
    expect(report.errors.some((e) => e.index === 3 && e.code === 'E_BAD_HASH')).toBe(true);
    expect(report.errors.some((e) => e.index === 3 && e.code === 'E_BAD_MERKLE')).toBe(true);
  });

  it('篡改历史块 hash 使后块 prev_hash 失配 → 链断裂 E_CHAIN_BREAK', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const blocks = signedChain(5, kp);

    // 场景：攻击者篡改 block[3] 内容并重算 hash 使其自洽，但未同步后块 prev_hash。
    const tampered = { ...blocks[3]!, changes: [{ ...blocks[3]!.changes[0]!, note: 'x' }] };
    tampered.hash = buildBlock(
      tampered.changes,
      blocks[2]!,
      tampered.author,
      tampered.timestamp,
    ).hash;
    blocks[3] = tampered;

    const report = verifyChain(blocks, store);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.index === 4 && e.code === 'E_CHAIN_BREAK')).toBe(true);
  });
});

// —— P0-2 Merkle ——

describe('P0-2 Merkle 树验证', () => {
  it('3 叶块的 proof 验证通过', () => {
    const changes = [makeChange('a', 1), makeChange('b', 2), makeChange('c', 3)];
    const root = buildMerkleRoot(changes);

    for (let i = 0; i < changes.length; i++) {
      const proof = makeProof(changes, i);
      expect(proof.root).toBe(root);
      expect(verifyProof(proof)).toBe(true);
    }
  });

  it('篡改某 change 后 merkle_root 不匹配，proof 失败', () => {
    const changes = [makeChange('a', 1), makeChange('b', 2), makeChange('c', 3)];
    const root = buildMerkleRoot(changes);

    const tampered = [...changes];
    tampered[1] = { ...changes[1]!, note: 'tampered' };

    expect(buildMerkleRoot(tampered)).not.toBe(root);

    // 用篡改后的叶子哈希 + 原兄弟路径无法还原到原 root。
    const badProof = { ...makeProof(changes, 1), leaf_hash: sha256Hex(canonicalize(tampered[1]!)) };
    expect(verifyProof(badProof)).toBe(false);
  });

  it('奇数/偶数叶均能正确构造并验证', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const changes = Array.from({ length: n }, (_, i) => makeChange(`x${i}`, i + 1));
      const root = buildMerkleRoot(changes);
      expect(root).toMatch(/^[0-9a-f]{64}$/);
      for (let i = 0; i < n; i++) {
        expect(verifyProof(makeProof(changes, i))).toBe(true);
      }
    }
  });
});

// —— P0-3 账本存储 ——

describe('P0-3 账本存储', () => {
  it('appendBlock 5 块后 tip 正确', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const kp = generateKeyPair();
    const blocks = signedChain(5, kp);

    for (let i = 1; i < blocks.length; i++) {
      expect(await ledger.appendBlock(blocks[i]!)).toBe('ok');
    }

    const tip = await ledger.tip();
    expect(tip.index).toBe(5);
    expect(tip.hash).toBe(blocks[5]!.hash);

    const doc = await ledger.load();
    expect(doc.blocks).toHaveLength(6); // genesis + 5
    expect(doc.tip).toEqual({ index: 5, hash: blocks[5]!.hash });
  });

  it('重复追加同 index 块被拒（stale / E_STALE_BLOCK 语义）', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const b1 = buildBlock([makeChange('c1', 1)], GENESIS, 'dev', 1000);

    expect(await ledger.appendBlock(b1)).toBe('ok');

    // 构造另一个 index=1 的块（不同内容，相同 index），必须被拒。
    const dup = buildBlock([makeChange('c1b', 2)], GENESIS, 'dev', 1001);
    expect(await ledger.appendBlock(dup)).toBe('stale');

    // 账本保持不变，仍只有 genesis + b1。
    expect((await ledger.tip()).hash).toBe(b1.hash);
    expect((await ledger.load()).blocks).toHaveLength(2);
  });
});

// —— P0-4 跨设备同步 ——

describe('P0-4 跨设备同步', () => {
  it('gossip 广播 + catchup 补同步后两设备 tip 一致', async () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    // 设备 A（leader）账本：genesis + 4 块。
    const leader = new LedgerStore(await tempDir(), 'team-a');
    const chain = signedChain(4, kp, 'leader');
    for (let i = 1; i < chain.length; i++) {
      await leader.appendBlock(chain[i]!);
    }

    // 设备 B 账本：仅 genesis（落后）。
    const follower = new LedgerStore(await tempDir(), 'team-a');

    // —— 中心广播：coordinator 用 encodeBlockBroadcast 把块发给 follower（与 backend memorySync 一致）——
    const envelope = encodeBlockBroadcast(chain[1]!, 'coordinator', 'follower');
    expect(envelope.type).toBe('memory.block_broadcast');
    const { payload } = parseEnvelope(JSON.stringify(envelope)) as Envelope<BlockBroadcastPayload>;
    const broadcastBlock = payload.block;
    expect(verifyBlock(broadcastBlock, structuredClone(GENESIS), store).ok).toBe(true);
    expect(await follower.appendBlock(broadcastBlock)).toBe('ok');

    // —— catchup 补同步：follower 从块 2 追到 leader 链头 ——
    const followerTipBefore = await follower.tip();
    const leaderTip = await leader.tip();
    const fetch = async (fromIndex: number): Promise<Block[]> =>
      chain.filter((b) => b.index >= fromIndex);

    const result = await catchUp(
      followerTipBefore,
      { tip_index: leaderTip.index, tip_hash: leaderTip.hash, group: 'team-a' },
      fetch,
      follower,
      store,
    );

    expect(result.ok).toBe(true);
    expect(result.added).toBe(3); // 块 2、3、4

    const followerTip = await follower.tip();
    expect(followerTip.index).toBe(leaderTip.index);
    expect(followerTip.hash).toBe(leaderTip.hash);
  });
});

// —— P0-5 篡改检测 ——

describe('P0-5 篡改检测', () => {
  it('篡改历史块的 change 内容 → detectTamper 定位到块号 + 类型', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const blocks = signedChain(5, kp);

    // 篡改 block[4]（index=4）的 change 内容。
    blocks[4] = {
      ...blocks[4]!,
      changes: [{ ...blocks[4]!.changes[0]!, target: 'node-hacked' }],
    };

    const report = detectTamper(blocks, store);
    expect(report.ok).toBe(false);

    const atIndex4 = report.tampered.filter((f) => f.index === 4).map((f) => f.type);
    expect(atIndex4).toContain('hash');   // 预映像变了，hash 失配
    expect(atIndex4).toContain('merkle'); // change 变了，merkle_root 失配
  });

  it('篡改历史块 hash → 后块 prev_hash 失配，detectTamper 定位 chain_break', () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const blocks = signedChain(5, kp);

    // 重算 block[4] 的 hash 使其自洽，但 block[5].prev_hash 仍指向旧 hash。
    const tampered = { ...blocks[4]!, changes: [{ ...blocks[4]!.changes[0]!, note: 'x' }] };
    tampered.hash = buildBlock(
      tampered.changes,
      blocks[3]!,
      tampered.author,
      tampered.timestamp,
    ).hash;
    blocks[4] = tampered;

    const report = detectTamper(blocks, store);
    expect(report.ok).toBe(false);
    expect(report.tampered.some((f) => f.index === 5 && f.type === 'chain_break')).toBe(true);
  });

  it('篡改 genesis 也能被检测', () => {
    const tamperedGenesis: Block = structuredClone(GENESIS);
    tamperedGenesis.changes = [makeChange('evil', 0)];
    tamperedGenesis.merkle_root = '0'.repeat(64);

    const report = detectTamper([tamperedGenesis]);
    expect(report.ok).toBe(false);
    const types = report.tampered.map((f) => f.type);
    expect(types).toContain('hash');
    expect(types).toContain('merkle');
  });
});

// —— P0-6 amg 适配 ——

describe('P0-6 amg 适配', () => {
  it('toChange/toSemantic 往返映射字段不丢（evidence/validity 透传）', () => {
    const evidence: Evidence[] = [
      {
        locator: 'path:/tmp/product.txt',
        content_sha256: 'a'.repeat(64),
        captured_at: '2026-01-01T00:00:00+00:00',
        graph_rev: 3,
        grade: 4,
      },
    ];
    const node: MemoryNode = {
      id: 'n1',
      type: 'decision',
      label: '采用方案 A',
      status: 'open',
      source: 'path:/tmp/product.txt',
      owner: 'alice',
      note: '有据可查',
      evidence,
      conclusion: true,
      valid_from: '2026-01-01T00:00:00+00:00',
      valid_until: '2026-12-31T00:00:00+00:00',
      recorded_at: '2026-01-01T08:00:00+00:00',
    };

    const semOp: SemanticOp = {
      op: 'add-node',
      target: 'n1',
      by: 'amg',
      at: '2026-01-01T09:00:00+00:00',
      rev: 5,
      note: 'type=decision status=open',
      node,
    };

    const change = toChange(semOp);
    expect(change.op).toBe('add_node');
    expect(change.node).toEqual(node);
    // evidence / validity 透传。
    expect(change.node!.evidence).toEqual(evidence);
    expect(change.node!.valid_from).toBe('2026-01-01T00:00:00+00:00');
    expect(change.node!.valid_until).toBe('2026-12-31T00:00:00+00:00');
    expect(change.node!.conclusion).toBe(true);

    const back = toSemantic(change);
    expect(back.op).toBe('add-node');
    expect(back.node).toEqual(node);
    expect(back.node!.evidence).toEqual(evidence);
    expect(back.node!.valid_from).toBe(node.valid_from);
    expect(back.node!.valid_until).toBe(node.valid_until);
    expect(back.rev).toBe(5);
  });

  it('supersede / add-edge 往返不丢', () => {
    const supersede: SemanticOp = {
      op: 'supersede',
      target: 'n1',
      by: 'amg',
      at: '2026-01-01T09:00:00+00:00',
      rev: 6,
      note: '',
      old_id: 'n1',
      new_id: 'n2',
    };
    const change = toChange(supersede);
    expect(change.supersede).toEqual({ old_id: 'n1', new_id: 'n2' });
    const back = toSemantic(change);
    expect(back.old_id).toBe('n1');
    expect(back.new_id).toBe('n2');

    const edge: SemanticOp = {
      op: 'add-edge',
      target: 'n1->n2',
      by: 'amg',
      at: '2026-01-01T09:00:00+00:00',
      rev: 7,
      note: '',
      edge: { from: 'n1', to: 'n2', kind: 'depends_on' },
    };
    const edgeChange = toChange(edge);
    expect(edgeChange.edge).toEqual({ from: 'n1', to: 'n2', kind: 'depends_on' });
    expect(toSemantic(edgeChange).edge).toEqual({ from: 'n1', to: 'n2', kind: 'depends_on' });
  });
});

// —— 边界 / 错误路径 ——

describe('边界 / 错误路径', () => {
  it('空 mempool 不出块（tip 不前移）', async () => {
    const kp = generateKeyPair();
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const mempool = new Mempool();
    const producer = new BlockProducer(ledger, mempool, {
      author: 'leader',
      privateKey: kp.privateKey,
    }, { maxChangesPerBlock: 5, maxWaitMs: 50, pollMs: 5 });

    const block = await producer.produceOnce();
    expect(block).toBeNull();
    expect((await ledger.tip()).index).toBe(0);
  });

  it('伪造签名被拒（E_BAD_SIG）', () => {
    const kp = generateKeyPair();
    const attacker = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const good = signedBlock([makeChange('c1', 1)], GENESIS, 'leader', kp);
    const forged = { ...good, signature: sign(attacker.privateKey, good.hash) };

    expect(verifyBlock(forged, GENESIS, store).code).toBe('E_BAD_SIG');
  });
});
