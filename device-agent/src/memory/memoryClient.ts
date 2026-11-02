/**
 * 设备侧记忆账本客户端（follower，只读追加）。
 *
 * - 本地维护 group="team" 的 LedgerStore（与 backend 同步收敛）
 * - 接收 memory.block_broadcast / block_response → verifyBlock 验签验链 → 追加 + 更新检索索引
 * - 提供 chainSummary 供上层上报链头、触发补同步
 *
 * 验签依赖 coordinator 公钥（经 register_ack 下发后 registerCoordinatorKey 登记）。
 */
import path from 'node:path';
import { LedgerStore, TrustStore, verifyBlock, MemorySearchIndex } from '@agentfleet/memory';
import type { Block, ChainSummary } from '@agentfleet/memory';
import { config } from '../config.js';

/** 追加区块结果（失败原因供 block_reject / block_request）。 */
export interface ApplyResult {
  ok: boolean;
  /** 失败原因：gap=漏块需拉取；stale=重复/乱序忽略；其余=验证失败（篡改） */
  reason?: string;
  /** gap 时：需要从该 index 开始拉取缺失区块。 */
  fromIndex?: number;
}

class MemoryClient {
  private readonly ledger = new LedgerStore(path.join(config.dataDir, 'memory'), 'team');
  private readonly trustStore = new TrustStore();
  private readonly searchIndex = new MemorySearchIndex();

  /** 初始化：加载本地账本（不存在则建 genesis）+ 重建检索索引。 */
  async init(): Promise<void> {
    const doc = await this.ledger.load();
    this.searchIndex.rebuild(doc.blocks.flatMap((b) => b.changes));
  }

  /** 登记 coordinator 公钥（来自 register_ack），设备据此验签。 */
  registerCoordinatorKey(publicKey: string): void {
    this.trustStore.register('coordinator', publicKey);
  }

  /** 本地链头摘要（用于 chain_summary 补同步请求）。 */
  async chainSummary(): Promise<ChainSummary> {
    const tip = await this.ledger.tip();
    return { tip_index: tip.index, tip_hash: tip.hash, group: 'team' };
  }

  /** 本地账本 tip（诊断/验收用）。 */
  async tipInfo(): Promise<{ index: number; hash: string }> {
    const tip = await this.ledger.tip();
    return { index: tip.index, hash: tip.hash };
  }

  /** 追加单个区块：验签验链 → 追加 → 更新检索索引。失败返回原因（供 block_reject）。 */
  async applyBlock(block: Block): Promise<ApplyResult> {
    const tip = await this.ledger.tip();
    // 序号关系先判：漏块（index > tip+1）→ 需主动拉取；重复/乱序（index < tip+1）→ 忽略
    if (block.index > tip.index + 1) {
      return { ok: false, reason: 'gap', fromIndex: tip.index + 1 };
    }
    if (block.index < tip.index + 1) {
      return { ok: false, reason: 'stale' };
    }
    const result = verifyBlock(block, tip, this.trustStore);
    if (!result.ok) {
      return { ok: false, reason: result.code ?? result.message };
    }
    const status = await this.ledger.appendBlock(block);
    if (status !== 'ok') {
      return { ok: false, reason: 'stale' };
    }
    for (const change of block.changes) this.searchIndex.add(change);
    return { ok: true };
  }

  /** 批量追加（block_response 补同步）。返回成功追加数。 */
  async applyBlocks(blocks: Block[]): Promise<number> {
    let added = 0;
    for (const block of blocks) {
      const r = await this.applyBlock(block);
      if (r.ok) added += 1;
    }
    return added;
  }

  /** 本地语义检索同步来的记忆（BM25 关键词召回）。 */
  search(query: string, limit = 10): Array<{ note: string; status?: string; score: number }> {
    return this.searchIndex.search(query, limit).map((h) => ({
      note: h.change.note,
      status: h.change.status,
      score: h.score,
    }));
  }
}

export const memoryClient = new MemoryClient();
