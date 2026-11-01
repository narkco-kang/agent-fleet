/**
 * 区块构造 + 哈希 + GENESIS 确定性常量。
 *
 * 区块哈希 = sha256Hex(canonicalize({prev_hash, merkle_root, timestamp, author, changes}))
 * signature 不参与 hash（避免循环依赖）。
 */
import { canonicalize } from '../crypto/canonical';
import { sha256Hex } from '../crypto/hash';
import { buildMerkleRoot } from './merkle';
import type { Block, BlockHeader, MemoryChange } from '../types/block';

/** 计算区块哈希（输入为哈希预映像字段，Block 可直接传入）。 */
export function computeHash(header: BlockHeader): string {
  return sha256Hex(
    canonicalize({
      prev_hash: header.prev_hash,
      merkle_root: header.merkle_root,
      timestamp: header.timestamp,
      author: header.author,
      changes: header.changes,
    }),
  );
}

/** 构造一个新块（不含签名，签名由 leader 在出块时用私钥补充）。 */
export function buildBlock(
  changes: MemoryChange[],
  tip: Block,
  author: string,
  timestamp: number = Date.now(),
): Block {
  const block: Block = {
    index: tip.index + 1,
    prev_hash: tip.hash,
    timestamp,
    merkle_root: buildMerkleRoot(changes),
    changes,
    author,
    signature: '',
    hash: '',
  };
  block.hash = computeHash(block);
  return block;
}

/** 创世块 —— 确定性常量，全网一致。 */
export const GENESIS: Block = {
  index: 0,
  prev_hash: '0'.repeat(64),
  timestamp: 0,
  merkle_root: sha256Hex(''),
  changes: [],
  author: 'genesis',
  signature: '',
  hash: '',
};
GENESIS.hash = computeHash(GENESIS);
Object.freeze(GENESIS.changes);
Object.freeze(GENESIS);
