/**
 * 记忆账本健壮性测试 —— 模拟「上下文断裂 / 丢失」场景，验证记忆不丢失。
 *
 * 用户诉求：模拟会导致单蜂群和蜂群间上下文断裂/丢失的操作（设备掉线、断连、重启、
 * 长时间离线、篡改、乱序/重复），验证账本记忆不丢失、检索正常。
 *
 * 覆盖：
 *   R-1 单蜂群上下文断裂：设备重启后账本持久化，所有 block 完好（哈希链 + 签名仍可验证）
 *   R-2 蜂群间断裂：设备长时间离线（落后 50 块）后重新上线，补同步全部缺失块，tip 收敛
 *   R-3 篡改拒收：补同步途中收到篡改块，拒收且不污染本地账本（后续好块仍可续传）
 *   R-4 补同步后检索：断线补同步的 change 进入语义检索索引，关键词能召回（记忆可检索）
 *   R-5 乱序 + 重复块幂等：乱序/重复块不导致丢块或重复追加，最终 tip 正确
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlock, GENESIS } from '../src/core/block';
import { generateKeyPair, sign, TrustStore } from '../src/crypto/ed25519';
import { LedgerStore } from '../src/storage/ledger';
import { catchUp } from '../src/sync/catchup';
import { verifyBlock, verifyChain } from '../src/validation/verifier';
import { MemorySearchIndex } from '../src/search/memory-index';
import type { Block, MemoryChange } from '../src/types/block';

function makeChange(id: string, rev: number, note = ''): MemoryChange {
  return {
    id,
    op: 'add_node',
    target: `node-${id}`,
    by: 'tester',
    at: '2026-01-01T00:00:00+00:00',
    rev,
    note,
  };
}

function signedBlock(
  changes: MemoryChange[],
  tip: Block,
  author: string,
  kp: { publicKey: string; privateKey: string },
  timestamp = 1000,
): Block {
  const block = buildBlock(changes, tip, author, timestamp);
  block.signature = sign(kp.privateKey, block.hash);
  return block;
}

/** 从 genesis 起连造 length 个签名块，返回 [genesis, b1, ..., bn]。 */
function signedChain(
  length: number,
  kp: { publicKey: string; privateKey: string },
  author = 'leader',
  notePrefix = 'c',
): Block[] {
  const blocks: Block[] = [structuredClone(GENESIS)];
  let tip = blocks[0]!;
  for (let i = 1; i <= length; i++) {
    const block = signedBlock(
      [makeChange(`${notePrefix}${i}`, i, `${notePrefix}${i} 的备注`)],
      tip,
      author,
      kp,
      1000 + i,
    );
    blocks.push(block);
    tip = block;
  }
  return blocks;
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'amm-resilience-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// —— R-1 单蜂群上下文断裂（设备重启 / 掉线） ——

describe('R-1 单蜂群上下文断裂（设备重启不丢记忆）', () => {
  it('设备写 10 块后「重启」，重新加载账本，所有块完好且整链可验签', { timeout: 30000 }, async () => {
    const dir = await tempDir();
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    // 设备在线期间写了 10 块
    let ledger = new LedgerStore(dir, 'team-a');
    const chain = signedChain(10, kp);
    for (let i = 1; i < chain.length; i++) {
      expect(await ledger.appendBlock(chain[i]!)).toBe('ok');
    }

    // 模拟重启：重新 new 一个 LedgerStore（读同一目录），旧实例「掉线」
    ledger = new LedgerStore(dir, 'team-a');
    const doc = await ledger.load();

    expect(doc.blocks).toHaveLength(11); // genesis + 10
    expect((await ledger.tip()).index).toBe(10);
    expect((await ledger.tip()).hash).toBe(chain[10]!.hash);

    // 整链完整性：哈希链 + Merkle + 签名全部可验证（记忆未被篡改/丢失）
    const report = verifyChain(doc.blocks, store);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('设备重启后从账本重建检索索引，历史记忆仍可召回', () => {
    const kp = generateKeyPair();
    const chain = signedChain(10, kp);

    // 模拟重启后从账本回放 change 重建索引（与 memoryLedger 启动逻辑一致）
    const index = new MemorySearchIndex();
    const allChanges = chain.flatMap((b) => b.changes);
    index.rebuild(allChanges);

    // 检索一条历史记忆（关键词命中 change 内容）
    const hits = index.search('备注');
    expect(hits.length).toBeGreaterThan(0);
    // 能召回带特定关键词的 change
    const hits2 = index.search('c5');
    expect(hits2.length).toBeGreaterThan(0);
  });
});

// —— R-2 蜂群间断裂（长时间离线 + 大量缺失块补同步） ——

describe('R-2 蜂群间断裂（离线补同步不丢记忆）', () => {
  it('设备离线 50 块后重新上线，补同步全部缺失块，tip 收敛到 leader', { timeout: 30000 }, async () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    // leader 在线期间出了 50 块
    const leader = new LedgerStore(await tempDir(), 'team-a');
    const chain = signedChain(50, kp, 'leader');
    await leader.appendBlocks(chain.slice(1));

    // follower 完全离线（仅 genesis，落后 50 块）
    const follower = new LedgerStore(await tempDir(), 'team-a');

    // 重新上线，发起补同步
    const result = await catchUp(
      structuredClone(GENESIS),
      { tip_index: 50, tip_hash: chain[50]!.hash, group: 'team-a' },
      async (from) => chain.filter((b) => b.index >= from),
      follower,
      store,
    );

    expect(result.ok).toBe(true);
    expect(result.added).toBe(50);
    expect((await follower.tip()).index).toBe(50);
    expect((await follower.tip()).hash).toBe(chain[50]!.hash);
    // 补同步后 follower 账本与 leader 完全一致（记忆无丢失）
    expect((await follower.load()).blocks).toHaveLength(51);
  });

  it('部分离线：follower 有前 10 块，离线期间 leader 再出 40 块，补同步 40 块', async () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const chain = signedChain(50, kp, 'leader');
    const follower = new LedgerStore(await tempDir(), 'team-a');
    await follower.appendBlocks(chain.slice(1, 11));

    const followerTipBefore = await follower.tip();
    const result = await catchUp(
      followerTipBefore,
      { tip_index: 50, tip_hash: chain[50]!.hash, group: 'team-a' },
      async (from) => chain.filter((b) => b.index >= from),
      follower,
      store,
    );

    expect(result.ok).toBe(true);
    expect(result.added).toBe(40); // 只补 11..50
    expect((await follower.tip()).index).toBe(50);
  });
});

// —— R-3 篡改拒收（上下文断裂期间收到篡改块） ——

describe('R-3 篡改拒收（不污染账本）', () => {
  it('补同步途中收到篡改块，拒收且不追加，本地账本保持干净', async () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const chain = signedChain(3, kp, 'leader');
    const follower = new LedgerStore(await tempDir(), 'team-a');

    // 对端链中，block 2 被篡改（hash 失配）
    const badChain = [...chain];
    badChain[2] = { ...chain[2]!, changes: [{ ...chain[2]!.changes[0]!, note: '被篡改' }] };

    const rejected: Array<{ index: number; reason: string }> = [];
    const result = await catchUp(
      structuredClone(GENESIS),
      { tip_index: 3, tip_hash: chain[3]!.hash, group: 'team-a' },
      async (from) => badChain.filter((b) => b.index >= from),
      follower,
      store,
      (reject) => {
        rejected.push({ index: reject.index, reason: reject.reason });
      },
    );

    expect(result.ok).toBe(false);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0]!.index).toBe(2);
    // 本地账本只追加了 block 1（合法的），block 2 被拒收未污染
    expect((await follower.tip()).index).toBe(1);
    expect((await follower.load()).blocks).toHaveLength(2); // genesis + b1
  });
});

// —— R-4 补同步后检索（记忆可检索） ——

describe('R-4 补同步后记忆可检索', () => {
  it('离线补同步的 change 进入索引后，关键词能召回（记忆不因断线丢失）', async () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);

    const chain = signedChain(20, kp, 'leader');
    const follower = new LedgerStore(await tempDir(), 'team-a');

    // 离线补同步
    const result = await catchUp(
      structuredClone(GENESIS),
      { tip_index: 20, tip_hash: chain[20]!.hash, group: 'team-a' },
      async (from) => chain.filter((b) => b.index >= from),
      follower,
      store,
    );
    expect(result.ok).toBe(true);

    // 从补同步的账本重建检索索引
    const index = new MemorySearchIndex();
    const doc = await follower.load();
    index.rebuild(doc.blocks.flatMap((b) => b.changes));

    // 能检索到补同步回来的 change
    expect(index.search('c15').length).toBeGreaterThan(0);
    expect(index.search('备注', 50).length).toBeGreaterThanOrEqual(20);
  });
});

// —— R-5 乱序 + 重复块幂等 ——

describe('R-5 乱序 + 重复块幂等（不丢块不重块）', () => {
  it('重复追加同 index 块被拒，账本不重复', async () => {
    const kp = generateKeyPair();
    const chain = signedChain(3, kp, 'leader');
    const ledger = new LedgerStore(await tempDir(), 'team-a');

    expect(await ledger.appendBlock(chain[1]!)).toBe('ok');
    // 重复追加同一块 → stale，不重复
    expect(await ledger.appendBlock(chain[1]!)).toBe('stale');
    expect((await ledger.load()).blocks).toHaveLength(2); // genesis + b1
  });

  it('乱序到达（先 2 后 1）时，乱序块不破坏链，最终靠 catchup 收敛', async () => {
    const kp = generateKeyPair();
    const store = new TrustStore();
    store.register('leader', kp.publicKey);
    const chain = signedChain(3, kp, 'leader');
    const ledger = new LedgerStore(await tempDir(), 'team-a');

    // 先到 block 2（乱序），appendBlock 应拒（index 2 != tip 0 + 1）
    expect(await ledger.appendBlock(chain[2]!)).toBe('stale');

    // 再 catchup 从 1 补齐 → 收敛
    const result = await catchUp(
      structuredClone(GENESIS),
      { tip_index: 3, tip_hash: chain[3]!.hash, group: 'team-a' },
      async (from) => chain.filter((b) => b.index >= from),
      ledger,
      store,
    );
    expect(result.ok).toBe(true);
    expect((await ledger.tip()).index).toBe(3);
  });
});
