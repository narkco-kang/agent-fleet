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

    let progressed = false;
    for (const block of blocks) {
      // 已落后于本地 tip（乱序/重复），重新读本地链头并跳过。
      if (block.index <= tip.index) {
        tip = await ledger.tip();
        continue;
      }

      const result = verifyBlock(block, tip, trustStore);
      if (!result.ok) {
        if (onReject) {
          await onReject({
            index: block.index,
            hash: block.hash,
            reason: result.code ?? result.message ?? 'invalid block',
          });
        }
        return { added, tip, ok: false };
      }

      const status = await ledger.appendBlock(block);
      if (status === 'stale') {
        tip = await ledger.tip();
        continue;
      }

      tip = block;
      added += 1;
      progressed = true;
    }

    if (!progressed) break;
  }

  return { added, tip, ok: tip.index >= peerTip.tip_index };
}
