/**
 * 团队记忆账本服务（AgentFleet 集成层）。
 *
 * backend 作为固定 leader，持有 group="team" 的分布式记忆账本：
 * 任务生命周期终态自动记账（构造 change → 立即出块 → Ed25519 签名 → 落盘）。
 * 账本为 append-only 哈希链（prev_hash 环环相扣），篡改可被整链校验定位。
 */
import { randomUUID } from 'node:crypto';
import {
  BlockProducer,
  LedgerStore,
  Mempool,
  TrustStore,
  generateKeyPair,
  verifyChainSigned,
} from '@agentfleet/memory';
import type { Block, MemoryChange } from '@agentfleet/memory';

/** 团队账本落盘目录（可被环境变量覆盖）。 */
const MEMORY_DIR = process.env.MEMORY_DIR ?? './data/memory';

class MemoryLedgerService {
  private readonly ledger = new LedgerStore(MEMORY_DIR, 'team');
  private readonly mempool = new Mempool();
  private readonly trustStore = new TrustStore();
  private readonly signer: { author: string; privateKey: string };
  private readonly producer: BlockProducer;
  /** amg 语义 rev（单调递增，重启后从账本 change 总数续起）。 */
  private rev = 0;

  constructor() {
    const kp = generateKeyPair();
    this.signer = { author: 'coordinator', privateKey: kp.privateKey };
    this.trustStore.register('coordinator', kp.publicKey);
    this.producer = new BlockProducer(this.ledger, this.mempool, this.signer, {
      maxChangesPerBlock: 50,
      maxWaitMs: 500,
    });
  }

  /** 初始化：加载账本（不存在则创建 genesis），并从已有 change 总数续 rev。 */
  async init(): Promise<void> {
    const doc = await this.ledger.load();
    this.rev = doc.blocks.reduce((n, b) => n + b.changes.length, 0);
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
    const change: MemoryChange = {
      id: `task:${input.taskId}:${input.status}`,
      op: 'set_status',
      target: `task:${input.taskId}`,
      by: 'coordinator',
      at: new Date().toISOString(),
      rev: ++this.rev,
      note: `${input.agentType}@${input.deviceId} 「${input.prompt.slice(0, 60)}」${
        input.resultText ? ` → ${input.resultText.slice(0, 60)}` : ''
      }`,
      status: input.status,
    };
    this.mempool.add(change);
    return this.flush();
  }

  /** 立即把 mempool 全部打包出块（签名 + 落盘）。 */
  async flush(): Promise<Block | null> {
    if (this.mempool.size() === 0) return null;
    const tip = await this.ledger.tip();
    const changes = this.mempool.drain(this.mempool.size());
    const block = this.producer.buildBlock(changes, tip);
    const status = await this.ledger.appendBlock(block);
    return status === 'ok' ? block : null;
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
      updatedAt: doc.updatedAt,
    };
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
