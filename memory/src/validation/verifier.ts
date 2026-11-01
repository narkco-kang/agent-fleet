/**
 * 验证层：收块验证 + 整链验证（含签名）+ 签名校验。
 *
 * 校验顺序固定：index → prev_hash → hash → merkle → signature，
 * 错误可精确到错误码与块号。genesis（index=0 && author="genesis"）验签特殊放行。
 */
import { GENESIS, computeHash } from '../core/block';
import { verifyChain as verifyChainStructural } from '../core/chain';
import type { ChainError, VerificationReport } from '../core/chain';
import { buildMerkleRoot } from '../core/merkle';
import { verify } from '../crypto/ed25519';
import type { TrustStore } from '../crypto/ed25519';
import type { Block } from '../types/block';
import { ERROR_CODES } from '../types';
import type { ErrorCode } from '../types';

/** 单块验证结果。 */
export interface VerificationResult {
  ok: boolean;
  code?: ErrorCode;
  message?: string;
}

/** 校验 block.signature（genesis 特殊放行）。 */
export function verifySignature(block: Block, trustStore: TrustStore): boolean {
  if (block.index === 0 && block.author === 'genesis') return true;
  const publicKey = trustStore.get(block.author);
  if (!publicKey) return false;
  return verify(publicKey, block.hash, block.signature);
}

/**
 * 校验单个待追加区块（相对 tip）。
 * 返回对应错误码：E_STALE_BLOCK / E_CHAIN_BREAK / E_BAD_HASH / E_BAD_MERKLE / E_BAD_SIG。
 */
export function verifyBlock(
  block: Block,
  tip: Block,
  trustStore: TrustStore,
): VerificationResult {
  if (block.index !== tip.index + 1) {
    return {
      ok: false,
      code: ERROR_CODES.E_STALE_BLOCK,
      message: `index=${block.index} but tip.index=${tip.index} (expected ${tip.index + 1})`,
    };
  }
  if (block.prev_hash !== tip.hash) {
    return {
      ok: false,
      code: ERROR_CODES.E_CHAIN_BREAK,
      message: `prev_hash=${block.prev_hash.slice(0, 12)}… but tip.hash=${tip.hash.slice(0, 12)}…`,
    };
  }
  if (computeHash(block) !== block.hash) {
    return {
      ok: false,
      code: ERROR_CODES.E_BAD_HASH,
      message: 'recomputed hash does not match stored hash',
    };
  }
  if (buildMerkleRoot(block.changes) !== block.merkle_root) {
    return {
      ok: false,
      code: ERROR_CODES.E_BAD_MERKLE,
      message: 'recomputed merkle_root does not match stored merkle_root',
    };
  }
  if (!verifySignature(block, trustStore)) {
    return {
      ok: false,
      code: ERROR_CODES.E_BAD_SIG,
      message: `signature invalid or author "${block.author}" not trusted`,
    };
  }
  return { ok: true };
}

/** 整链验证（结构 + 哈希 + Merkle + 签名），错误精确到块号与类型。 */
export function verifyChain(
  blocks: Block[],
  trustStore: TrustStore,
): VerificationReport {
  const structural = verifyChainStructural(blocks);
  const errors: ChainError[] = [...structural.errors];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (!verifySignature(block, trustStore)) {
      errors.push({
        code: ERROR_CODES.E_BAD_SIG,
        index: i,
        message: `signature invalid or author "${block.author}" not trusted`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 便捷：校验 genesis 常量（供上层/测试复用）。 */
export function isGenesis(block: Block): boolean {
  return block.index === 0 && block.hash === GENESIS.hash;
}
