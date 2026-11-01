/**
 * Gossip 广播 + 中继转发去重（去重键 = block.hash）。
 *
 * 同一块不重复转发（洪泛去重）；局域网直连与云端中继均通过 relay 回调透传。
 */
import type { Block } from '../types/block';
import type { Envelope } from '../types/protocol';
import { encodeBlockBroadcast } from './messages';

/** 中继/发送回调：把信封发给指定对端。 */
export type RelayFn = (
  to: string,
  message: Envelope<unknown>,
) => void | Promise<void>;

/**
 * Gossip 节点：持有「已见区块 hash」去重集合，负责广播与转发。
 */
export class GossipNode {
  private readonly seen = new Set<string>();

  constructor(
    private readonly relay: RelayFn,
    private readonly selfId: string,
  ) {}

  /** 是否已见某区块 hash。 */
  hasSeen(blockHash: string): boolean {
    return this.seen.has(blockHash);
  }

  /** 标记已见。 */
  markSeen(blockHash: string): void {
    this.seen.add(blockHash);
  }

  /**
   * 广播区块到已知对端；按 block.hash 去重（同一块不重复转发）。
   * @returns 本次实际转发的对端 id 列表。
   */
  async broadcastBlock(block: Block, peers: string[]): Promise<string[]> {
    if (this.seen.has(block.hash)) return [];
    this.seen.add(block.hash);

    const forwarded: string[] = [];
    for (const peer of peers) {
      if (peer === this.selfId) continue;
      await this.relay(
        peer,
        encodeBlockBroadcast(block, this.selfId, peer),
      );
      forwarded.push(peer);
    }
    return forwarded;
  }
}
