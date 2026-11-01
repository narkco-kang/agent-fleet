/**
 * 篡改定位：detectTamper —— 精确指出「哪一块」被篡改 + 篡改类型。
 *
 * 通过逐块重算 hash / merkle / 签名，并检测 prev_hash 链断裂来定位。
 * 类型：hash / merkle / signature / chain_break。
 */
import { computeHash } from '../core/block';
import { buildMerkleRoot } from '../core/merkle';
import { verifySignature } from './verifier';
import type { TrustStore } from '../crypto/ed25519';
import type { Block } from '../types/block';

/** 篡改类型。 */
export type TamperType = 'hash' | 'merkle' | 'signature' | 'chain_break';

/** 单条篡改发现。 */
export interface TamperFinding {
  index: number;
  type: TamperType;
}

/** 篡改检测报告。 */
export interface TamperReport {
  ok: boolean;
  tampered: TamperFinding[];
}

/**
 * 定位被篡改的块。
 *
 * @param blocks 待检测链（含 genesis）。
 * @param trustStore 可选；提供时额外做签名篡改检测。
 */
export function detectTamper(
  blocks: Block[],
  trustStore?: TrustStore,
): TamperReport {
  const tampered: TamperFinding[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;

    // 1) Merkle：change 内容被改 → 重算根与存储根不一致。
    if (buildMerkleRoot(block.changes) !== block.merkle_root) {
      tampered.push({ index: i, type: 'merkle' });
    }

    // 2) 哈希：任一预映像字段被改 → 重算 hash 与存储 hash 不一致。
    if (computeHash(block) !== block.hash) {
      tampered.push({ index: i, type: 'hash' });
    }

    // 3) 链断裂：前一区块 hash 与当前 prev_hash 不一致。
    if (i > 0 && block.prev_hash !== blocks[i - 1]!.hash) {
      tampered.push({ index: i, type: 'chain_break' });
    }

    // 4) 签名：来源伪造 / 签名被改。
    if (trustStore && !verifySignature(block, trustStore)) {
      tampered.push({ index: i, type: 'signature' });
    }
  }

  return { ok: tampered.length === 0, tampered };
}
