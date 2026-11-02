/**
 * 团队记忆账本服务（AgentFleet 集成层）。
 *
 * backend 作为固定 leader，持有 group="team" 的分布式记忆账本：
 * 任务生命周期终态自动记账（构造 change → 立即出块 → Ed25519 签名 → 落盘）。
 * 账本为 append-only 哈希链（prev_hash 环环相扣），篡改可被整链校验定位。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  BlockProducer,
  LedgerStore,
  Mempool,
  TrustStore,
  generateKeyPair,
  verifyChainSigned,
  scrubSecrets,
  MemorySearchIndex,
} from '@agentfleet/memory';
import type { Block, MemoryChange, KeyPair } from '@agentfleet/memory';

/** 团队账本落盘目录（可被环境变量覆盖）。 */
const MEMORY_DIR = process.env.MEMORY_DIR ?? './data/memory';

/**
 * 加载或生成 coordinator 的 Ed25519 密钥对（持久化）。
 * 密钥必须跨重启复用，否则旧区块签名无法被新公钥验证，账本完整性自毁。
 */
function loadOrCreateKeyPair(): KeyPair {
  const keyPath = path.join(MEMORY_DIR, 'coordinator.key.json');
  try {
    const raw = readFileSync(keyPath, 'utf8');
    const kp = JSON.parse(raw) as KeyPair;
    if (kp.publicKey && kp.privateKey) return kp;
  } catch {
    /* 首次启动或文件损坏，走生成 */
  }
  const kp = generateKeyPair();
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(keyPath, JSON.stringify(kp, null, 2), { mode: 0o600 });
  return kp;
}

class MemoryLedgerService {
  private readonly ledger = new LedgerStore(MEMORY_DIR, 'team');
  private readonly mempool = new Mempool();
  private readonly trustStore = new TrustStore();
  private readonly signer: { author: string; privateKey: string; publicKey: string };
  private readonly producer: BlockProducer;
  /** amg 语义 rev（单调递增，重启后从账本 change 总数续起）。 */
  private rev = 0;
  /** 语义检索索引（借鉴 AgentMemory：BM25 关键词召回，可重建、可丢弃，账本仍 append-only）。 */
  private readonly searchIndex = new MemorySearchIndex();
  /** 出块回调（memorySync 注入：广播新区块给所有在线设备）。 */
  private onBlock: ((block: Block) => void | Promise<void>) | null = null;

  constructor() {
    const kp = loadOrCreateKeyPair();
    this.signer = { author: 'coordinator', privateKey: kp.privateKey, publicKey: kp.publicKey };
    this.trustStore.register('coordinator', kp.publicKey);
    this.producer = new BlockProducer(this.ledger, this.mempool, this.signer, {
      maxChangesPerBlock: 50,
      maxWaitMs: 500,
    });
  }

  /** coordinator 公钥（随设备注册下发，供设备验签）。 */
  getCoordinatorPublicKey(): string {
    return this.signer.publicKey;
  }

  /** 注入出块广播回调。 */
  setOnBlock(fn: (block: Block) => void | Promise<void>): void {
    this.onBlock = fn;
  }

  /** 初始化：加载账本（不存在则创建 genesis），并从已有 change 总数续 rev + 重建检索索引。 */
  async init(): Promise<void> {
    const doc = await this.ledger.load();
    this.rev = doc.blocks.reduce((n, b) => n + b.changes.length, 0);
    // 从账本回放全部 change，重建语义检索索引（启动即恢复召回能力）
    this.searchIndex.rebuild(doc.blocks.flatMap((b) => b.changes));
  }

  /**
   * 记录一条任务终态到团队账本（立即出块）。
   * 幂等：同 taskId 在同一终态只记一次（change.id 稳定）。
   */
  async recordTaskTerminal(input: {
    taskId: string;
    deviceId: string;
    agentType: string;
    prompt: string;
    status: string;
    resultText?: string;
  }): Promise<Block | null> {
    // 写入前脱敏：账本 append-only 不可删，secret 必须在落盘前剥离
    const note = scrubSecrets(
      `${input.agentType}@${input.deviceId} 「${input.prompt.slice(0, 60)}」${
        input.resultText ? ` → ${input.resultText.slice(0, 60)}` : ''
      }`,
    );
    const change: MemoryChange = {
      id: `task:${input.taskId}:${input.status}`,
      op: 'set_status',
      target: `task:${input.taskId}`,
      by: 'coordinator',
      at: new Date().toISOString(),
      rev: ++this.rev,
      note,
      status: input.status,
    };
    this.mempool.add(change);
    this.searchIndex.add(change); // 立即入检索索引（不等出块）
    return this.flush();
  }

  /** 立即把 mempool 全部打包出块（签名 + 落盘 + 触发广播）。 */
  async flush(): Promise<Block | null> {
    if (this.mempool.size() === 0) return null;
    const tip = await this.ledger.tip();
    const changes = this.mempool.drain(this.mempool.size());
    const block = this.producer.buildBlock(changes, tip);
    const status = await this.ledger.appendBlock(block);
    if (status === 'ok') {
      await this.onBlock?.(block);
      return block;
    }
    return null;
  }

  /** 返回 index 之后的全部区块（设备补同步用）。 */
  async getBlocksAfter(index: number): Promise<Block[]> {
    const doc = await this.ledger.load();
    return doc.blocks.filter((b) => b.index > index);
  }

  /** 返回 [from, to] 区间的区块（设备主动拉取用）。 */
  async getBlocksBetween(from: number, to?: number): Promise<Block[]> {
    const doc = await this.ledger.load();
    return doc.blocks.filter((b) => b.index >= from && (to === undefined || b.index <= to));
  }

  /** 账本摘要 + 整链健康校验（结构 + 哈希 + Merkle + 签名）。 */
  async summary(): Promise<Record<string, unknown>> {
    const doc = await this.ledger.load();
    let healthy = true;
    let error: string | null = null;
    try {
      const report = verifyChainSigned(doc.blocks, this.trustStore);
      healthy = report.ok;
      if (!report.ok && report.errors.length) {
        error = `${report.errors[0]!.code}@block ${report.errors[0]!.index}`;
      }
    } catch (e) {
      healthy = false;
      error = (e as Error).message;
    }
    return {
      group: 'team',
      schema: 'amm/v1',
      blocks: doc.blocks.length,
      changes: doc.blocks.reduce((n, b) => n + b.changes.length, 0),
      tipIndex: doc.tip.index,
      tipHash: doc.tip.hash,
      healthy,
      error,
      indexed: this.searchIndex.size(),
      updatedAt: doc.updatedAt,
    };
  }

  /** 语义召回：关键词搜索记忆账本（借鉴 AgentMemory 的 keyless BM25）。 */
  search(query: string, limit = 10): Array<{ change: MemoryChange; score: number }> {
    return this.searchIndex.search(query, limit).map((h) => ({
      change: h.change,
      score: h.score,
    }));
  }

  /** 相似记忆：找与给定文本 Jaccard 相似度 >= threshold 的历史记录（近重复/推荐）。 */
  findSimilar(text: string, threshold = 0.6, limit = 5): Array<{ change: MemoryChange; score: number }> {
    return this.searchIndex.findSimilar(text, threshold, limit).map((h) => ({
      change: h.item,
      score: h.score,
    }));
  }

  /** 供测试/诊断生成一条任意 change（随机 uuid，不幂等）。 */
  async recordChange(op: MemoryChange['op'], note: string, status?: string): Promise<Block | null> {
    const change: MemoryChange = {
      id: randomUUID(),
      op,
      target: `diag:${Date.now()}`,
      by: 'coordinator',
      at: new Date().toISOString(),
      rev: ++this.rev,
      note,
      status,
    };
    this.mempool.add(change);
    return this.flush();
  }
}

export const memoryLedger = new MemoryLedgerService();
