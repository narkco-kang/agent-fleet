/**
 * 区块与交易（change）类型 —— 全项目单一事实源。
 *
 * 字节序约定：hash/prev_hash/merkle_root 一律 64 位小写 hex；
 * signature 为 Ed25519 原始 64 字节的 base64（不参与 hash，避免循环依赖）。
 */
import type { MemoryEdge, MemoryNode } from './memory';

/** 语义操作类型（对齐 amg changes[].op，下划线风格）。 */
export type ChangeOp =
  | 'add_node'
  | 'import_node'
  | 'set_status'
  | 'add_edge'
  | 'supersede'
  | 'expire';

/** supersede 操作的语义载荷。 */
export interface SupersedePayload {
  old_id: string;
  new_id: string;
}

/** 写入溯源（provenance 链，docs/25 落地清单第 4 项）：记录这条 change 由哪个任务/会话产生。 */
export interface ChangeProvenance {
  /** 源任务 id。 */
  taskId?: string;
  /** 源会话 id。 */
  sessionId?: string;
  /** 源设备 id。 */
  deviceId?: string;
  /** 源 agent 平台。 */
  agentType?: string;
}

/** 块内交易（与 amg 语义兼容）。 */
export interface MemoryChange {
  /** 本 change 的稳定标识（uuid），Merkle 叶子定位 / 幂等去重用。 */
  id: string;
  op: ChangeOp;
  /** 目标节点 id（或 edge 的 "from->to"）。 */
  target: string;
  /** 写入者标识。 */
  by: string;
  /** 交易时间 ISO-8601。 */
  at: string;
  /** amg 语义 rev（单调递增）。 */
  rev: number;
  /** 备注。 */
  note: string;
  /** add_node / import_node 的语义载荷。 */
  node?: MemoryNode;
  /** add_edge 的语义载荷。 */
  edge?: MemoryEdge;
  /** set_status 的目标状态。 */
  status?: string;
  /** supersede 的语义载荷。 */
  supersede?: SupersedePayload;
  /** 写入溯源（可选；记录源任务/会话，供检索追溯）。 */
  provenance?: ChangeProvenance;
}

/**
 * 区块哈希预映像字段 —— 精确对齐架构约定：
 * sha256Hex(canonicalize({prev_hash, merkle_root, timestamp, author, changes}))
 */
export interface BlockHeader {
  prev_hash: string;
  merkle_root: string;
  timestamp: number;
  author: string;
  changes: MemoryChange[];
}

/** 区块。 */
export interface Block extends BlockHeader {
  /** 区块序号，0 起单调 +1。 */
  index: number;
  /** Ed25519(privkey, hash) 的 base64；genesis 为空。 */
  signature: string;
  /** 本块哈希（由 computeHash 计算）。 */
  hash: string;
}

/** Merkle 证明中的兄弟节点。 */
export interface MerkleSibling {
  hash: string;
  side: 'left' | 'right';
}

/** Merkle 包含证明（从叶到根）。 */
export interface MerkleProof {
  /** change 在 changes[] 中的下标。 */
  leaf_index: number;
  /** 该 change 的叶子哈希。 */
  leaf_hash: string;
  /** 从叶到根的兄弟路径。 */
  siblings: MerkleSibling[];
  /** 期望的 merkle_root。 */
  root: string;
}
