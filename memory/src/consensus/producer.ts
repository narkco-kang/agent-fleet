/**
 * BlockProducer：固定 leader 出块循环。
 *
 * 出块条件：「N 条 change 或 T 秒先到即出块」（先到即触发）；空 mempool 不出块。
 * 出块后本地账本 tip 前移，广播由调用方通过 onBlock 回调完成。
 */
import { buildBlock } from '../core/block';
import { sign } from '../crypto/ed25519';
import type { LedgerStore } from '../storage/ledger';
import type { Block, MemoryChange } from '../types/block';
import { Mempool } from './mempool';

/** 出块参数。 */
export interface ProducerOptions {
  /** 每条块最多打包 change 数（默认 20）。 */
  maxChangesPerBlock?: number;
  /** 最长等待时间（默认 10000ms）。 */
  maxWaitMs?: number;
  /** 轮询间隔（默认 10ms）。 */
  pollMs?: number;
}

export const DEFAULT_BLOCK_MAX_CHANGES = 20;
export const DEFAULT_BLOCK_INTERVAL_MS = 10000;

/** leader 签名器：author（deviceId）+ 私钥。 */
export interface Signer {
  author: string;
  privateKey: string;
}

/** 固定 leader 出块器。 */
export class BlockProducer {
  readonly mempool: Mempool;
  readonly ledger: LedgerStore;
  private readonly signer: Signer;
  private readonly maxChangesPerBlock: number;
  private readonly maxWaitMs: number;
  private readonly pollMs: number;
  private stopped = false;

  constructor(
    ledger: LedgerStore,
    mempool: Mempool,
    signer: Signer,
    options: ProducerOptions = {},
  ) {
    this.ledger = ledger;
    this.mempool = mempool;
    this.signer = signer;
    this.maxChangesPerBlock =
      options.maxChangesPerBlock ?? DEFAULT_BLOCK_MAX_CHANGES;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_BLOCK_INTERVAL_MS;
    this.pollMs = options.pollMs ?? 10;
  }

  /** 构造并签名一个区块（不写盘）。 */
  buildBlock(changes: MemoryChange[], tip: Block): Block {
    const block = buildBlock(changes, tip, this.signer.author);
    block.signature = sign(this.signer.privateKey, block.hash);
    return block;
  }

  /**
   * 单次出块：等待「N 条 或 T 秒先到」，drain 后出块并写盘。
   * 空 mempool 且等待期满仍为空 → 返回 null（不出块）。
   */
  async produceOnce(): Promise<Block | null> {
    const start = Date.now();

    // 等待出块条件满足：size >= N 或 elapsed >= T。
    while (true) {
      const elapsed = Date.now() - start;
      if (this.mempool.size() > 0) {
        if (
          this.mempool.size() >= this.maxChangesPerBlock ||
          elapsed >= this.maxWaitMs
        ) {
          break;
        }
      } else if (elapsed >= this.maxWaitMs) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }

    const tip = await this.ledger.tip();
    const changes = this.mempool.drain(this.maxChangesPerBlock);
    if (changes.length === 0) return null;

    const block = this.buildBlock(changes, tip);
    const status = await this.ledger.appendBlock(block);
    if (status !== 'ok') return null;
    return block;
  }

  /**
   * 启动出块循环。返回一个 stop 函数停止循环。
   * 每产出一个块调用 onBlock 回调（供广播）。
   */
  start(onBlock?: (block: Block) => void | Promise<void>): () => void {
    this.stopped = false;
    const loop = async (): Promise<void> => {
      while (!this.stopped) {
        try {
          const block = await this.produceOnce();
          if (block && onBlock) await onBlock(block);
        } catch {
          // 单轮异常不终止循环（避免瞬时 IO 错误打停出块）。
          await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        }
      }
    };
    void loop();
    return () => {
      this.stopped = true;
    };
  }
}
