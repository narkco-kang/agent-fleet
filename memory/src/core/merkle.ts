/**
 * Merkle 树：buildMerkleRoot / makeProof / verifyProof。
 *
 * 单 sha256（canonical_json 已是结构化数据，无长度扩展攻击面）：
 *   叶子   = sha256Hex(canonicalize(change))
 *   内节点 = sha256Hex(leftHex + rightHex)
 * 奇数叶子复制末叶（比特币同款），保证每层两两配对、树结构确定，
 * 证明路径长度恒为 ceil(log2(n))，无需处理「悬空右子」特例。
 * 空块 merkle_root = sha256Hex("")（固定值 e3b0c442...b855）。
 */
import { canonicalize } from '../crypto/canonical';
import { sha256Hex } from '../crypto/hash';
import type { MemoryChange, MerkleProof, MerkleSibling } from '../types/block';
import { ERROR_CODES } from '../types';

/** 单个 change 的叶子哈希。 */
export function leafHash(change: MemoryChange): string {
  return sha256Hex(canonicalize(change));
}

/** 计算 changes 的 Merkle 根（空数组返回 sha256Hex("")）。 */
export function buildMerkleRoot(changes: MemoryChange[]): string {
  if (changes.length === 0) return sha256Hex('');
  let level = changes.map((change) => leafHash(change));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(sha256Hex(left + right));
    }
    level = next;
  }
  return level[0]!;
}

/** 为 changes[index] 构造从叶到根的 Merkle 证明。 */
export function makeProof(changes: MemoryChange[], index: number): MerkleProof {
  if (changes.length === 0) {
    throw new Error(
      `${ERROR_CODES.E_BAD_CHANGE}: cannot make a Merkle proof for an empty block`,
    );
  }
  if (!Number.isInteger(index) || index < 0 || index >= changes.length) {
    throw new Error(
      `${ERROR_CODES.E_BAD_INDEX}: leaf index ${index} out of range`,
    );
  }

  const leaf_hash = leafHash(changes[index]!);
  const siblings: MerkleSibling[] = [];

  let level = changes.map((change) => leafHash(change));
  let idx = index;
  while (level.length > 1) {
    const pairIdx = Math.floor(idx / 2);
    const leftIdx = pairIdx * 2;
    // 奇数层复制末叶：右兄弟即左兄弟自身。
    const rightIdx = leftIdx + 1 < level.length ? leftIdx + 1 : leftIdx;

    if (idx === leftIdx) {
      siblings.push({ hash: level[rightIdx]!, side: 'right' });
    } else {
      siblings.push({ hash: level[leftIdx]!, side: 'left' });
    }

    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(sha256Hex(left + right));
    }
    level = next;
    idx = pairIdx;
  }

  return { leaf_index: index, leaf_hash, siblings, root: level[0]! };
}

/** 验证 Merkle 证明：从叶到根逐层重算，最终与 root 比对。 */
export function verifyProof(proof: MerkleProof): boolean {
  let h = proof.leaf_hash;
  for (const sibling of proof.siblings) {
    h =
      sibling.side === 'left'
        ? sha256Hex(sibling.hash + h)
        : sha256Hex(h + sibling.hash);
  }
  return h === proof.root;
}
