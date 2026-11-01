/**
 * 哈希链校验（纯结构：genesis + index + prev_hash + hash + merkle）。
 *
 * 签名校验需要信任表，落在 validation/verifier.ts（本模块保持无 IO、无状态）。
 * 篡改任意历史块 → 该块 hash 变 → 后一块 prev_hash 不匹配 → 链断裂，
 * 且能精确定位到断裂块（比 amg 一次性 history_sha256 更强的能力）。
 */
import { GENESIS, computeHash } from './block';
import { buildMerkleRoot } from './merkle';
import type { Block } from '../types/block';
import { ERROR_CODES } from '../types';
import type { ErrorCode } from '../types';

/** 单条链校验错误（精确到块号 + 错误类型）。 */
export interface ChainError {
  code: ErrorCode;
  index: number;
  message: string;
}

/** 链校验报告。 */
export interface VerificationReport {
  ok: boolean;
  errors: ChainError[];
}

/** 判断 cur 是否以 prev 为前驱（prev_hash 链接 + index 单调 +1）。 */
export function isLinked(prev: Block, cur: Block): boolean {
  return cur.index === prev.index + 1 && cur.prev_hash === prev.hash;
}

/** 校验整条哈希链（结构 + 哈希 + Merkle，不含签名）。 */
export function verifyChain(blocks: Block[]): VerificationReport {
  const errors: ChainError[] = [];

  if (blocks.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: ERROR_CODES.E_BAD_GENESIS,
          index: 0,
          message: 'chain is empty (missing genesis)',
        },
      ],
    };
  }

  const genesis = blocks[0]!;
  if (genesis.hash !== GENESIS.hash || genesis.index !== 0) {
    errors.push({
      code: ERROR_CODES.E_BAD_GENESIS,
      index: 0,
      message: 'genesis block does not match the deterministic constant',
    });
  }

  // genesis 的 prev_hash 是全 0 哨兵（链起点），后续块才链接到前一区块 hash。
  let prev = '0'.repeat(64);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;

    if (block.index !== i) {
      errors.push({
        code: ERROR_CODES.E_BAD_INDEX,
        index: i,
        message: `block.index=${block.index} but expected ${i}`,
      });
    }

    if (block.prev_hash !== prev) {
      errors.push({
        code: ERROR_CODES.E_CHAIN_BREAK,
        index: i,
        message: `prev_hash=${block.prev_hash.slice(0, 12)}… but expected ${prev.slice(0, 12)}…`,
      });
    }

    if (computeHash(block) !== block.hash) {
      errors.push({
        code: ERROR_CODES.E_BAD_HASH,
        index: i,
        message: 'recomputed hash does not match stored hash',
      });
    }

    if (buildMerkleRoot(block.changes) !== block.merkle_root) {
      errors.push({
        code: ERROR_CODES.E_BAD_MERKLE,
        index: i,
        message: 'recomputed merkle_root does not match stored merkle_root',
      });
    }

    prev = block.hash;
  }

  return { ok: errors.length === 0, errors };
}
