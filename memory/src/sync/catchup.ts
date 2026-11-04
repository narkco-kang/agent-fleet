/**
 * 断线补同步：落后方拉取缺失区块 → 逐块验证 → 追加 → 收敛到对端链头。
 *
 * 收到非法块 → 回 block_reject（含 reason），不追加，中止本轮补同步。
 */
import type { TrustStore } from '../crypto/ed25519';
import type { LedgerStore } from '../storage/ledger';
import type { Block } from '../types/block';
import type { BlockRejectPayload, ChainSummary } from '../types/protocol';
import { verifyBlock } from '../validation/verifier';

/** 拉取区块回调（落后方发 block_request 后对端回 block_response）。 */
export type FetchBlocks = (
  fromIndex: number,
  toIndex?: number,
) => Promise<Block[]>;

/** 拒收告警回调（发 block_reject）。 */
export type SendReject = (reject: BlockRejectPayload) => void | Promise<void>;

/** 补同步结果。 */
export interface CatchUpResult {
  added: number;
  tip: Block;
  ok: boolean;
}

/**
 * 落后方补同步：从 selfTip 追到 peerTip。
 *
 * @param selfTip 己方当前链头。
 * @param peerTip 对端链头摘要。
 * @param fetch 拉取区块实现。
 * @param ledger 本地账本。
 * @param trustStore 验签信任表。
 * @param onReject 收到非法块时的拒收回调（可选）。
 */
export async function catchUp(
  selfTip: Block,
  peerTip: ChainSummary,
  fetch: FetchBlocks,
  ledger: LedgerStore,
  trustStore: TrustStore,
  onReject?: SendReject,
): Promise<CatchUpResult> {
  let tip = selfTip;
  let added = 0;

  while (tip.index < peerTip.tip_index) {
    const blocks = await fetch(tip.index + 1, peerTip.tip_index);
    if (!blocks || blocks.length === 0) break;

    // 逐块验证，收集连续的合法块；遇到非法块立即拒收中止（非法块不落盘）。
    // 验证全部通过后一次性批量落盘（appendBlocks），避免逐块全量重写文件（O(n²)）。
    const valid: Block[] = [];
    let prev = tip;
    let rejected: BlockRejectPayload | null = null;

    for (const block of blocks) {
      // 已落后于当前链头（乱序/重复），跳过。
      if (block.index <= prev.index) continue;

      const result = verifyBlock(block, prev, trustStore);
      if (!result.ok) {
        rejected = {
          index: block.index,
          hash: block.hash,
          reason: result.code ?? result.message ?? 'invalid block',
        };
        break;
      }

      valid.push(block);
      prev = block;
    }

    if (valid.length > 0) {
      const n = await ledger.appendBlocks(valid);
      added += n;
      tip = valid[valid.length - 1]!;
    }

    if (rejected) {
      if (onReject) await onReject(rejected);
      return { added, tip, ok: false };
    }

    if (valid.length === 0) break;
  }

  return { added, tip, ok: tip.index >= peerTip.tip_index };
}
