/**
 * 跨设备同步协议消息类型（账本侧扩展，不改 AgentFleet 现有 messageTypes）。
 *
 * 信封对齐 @agentfleet/shared 的 Envelope：type + payload，业务内容放 payload。
 * 消息类型点分小写，对齐 AgentFleet 命名规范 `域.动作`。
 */
import type { Block, MerkleProof } from './block';

/** 账本侧扩展的同步消息类型。 */
export type MemoryMessageType =
  | 'memory.block_broadcast'
  | 'memory.block_request'
  | 'memory.block_response'
  | 'memory.chain_summary'
  | 'memory.chain_sync'
  | 'memory.block_reject'
  | 'memory.proof_request'
  | 'memory.proof_response';

/** 同步信封（对齐 AgentFleet Envelope）。 */
export interface Envelope<T = unknown> {
  v: 1;
  type: string;
  id: string;
  ts: number;
  from: string;
  to: string;
  payload: T;
}

/** 链头摘要（快速判断谁领先 / 分叉）。 */
export interface ChainSummary {
  tip_index: number;
  tip_hash: string;
  group: string;
}

/** memory.block_broadcast payload。 */
export interface BlockBroadcastPayload {
  block: Block;
}

/** memory.block_request payload。 */
export interface BlockRequestPayload {
  from_index: number;
  to_index?: number;
}

/** memory.block_response payload。 */
export interface BlockResponsePayload {
  blocks: Block[];
}

/** memory.chain_summary / memory.chain_sync payload。 */
export interface ChainSummaryPayload {
  summary: ChainSummary;
}

/** memory.chain_sync payload（携带己方链头）。 */
export interface ChainSyncPayload {
  summary: ChainSummary;
}

/** memory.block_reject payload（拒收告警，篡改检测落点）。 */
export interface BlockRejectPayload {
  index: number;
  hash: string;
  reason: string;
}

/** memory.proof_request payload。 */
export interface ProofRequestPayload {
  block_index: number;
  change_id: string;
}

/** memory.proof_response payload。 */
export interface ProofResponsePayload {
  proof: MerkleProof;
}
