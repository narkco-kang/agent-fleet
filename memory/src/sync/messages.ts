/**
 * 同步消息类型 + 编解码（对齐 Envelope{type,payload}）。
 * 账本侧定义，不污染 AgentMesh 共享类型，走同一传输信道。
 */
import { randomUUID } from 'node:crypto';
import type { Block, MerkleProof } from '../types/block';
import type {
  BlockBroadcastPayload,
  BlockRejectPayload,
  BlockRequestPayload,
  BlockResponsePayload,
  ChainSummary,
  ChainSummaryPayload,
  Envelope,
  MemoryMessageType,
  ProofRequestPayload,
  ProofResponsePayload,
} from '../types/protocol';

/** 构造账本同步信封。 */
export function encodeMemoryMessage<T>(
  type: MemoryMessageType,
  payload: T,
  from: string,
  to: string,
): Envelope<T> {
  return {
    v: 1,
    type,
    id: randomUUID(),
    ts: Date.now(),
    from,
    to,
    payload,
  };
}

/** 解码账本同步信封（透传，供上层按 type 分支）。 */
export function decodeMemoryMessage<T = unknown>(
  raw: Envelope<T>,
): { type: MemoryMessageType; payload: T; envelope: Envelope<T> } {
  return { type: raw.type as MemoryMessageType, payload: raw.payload, envelope: raw };
}

/** 是否账本侧消息。 */
export function isMemoryMessage(type: string): type is MemoryMessageType {
  return type.startsWith('memory.');
}

/** 信封序列化（传输用，round-trip 无损）。 */
export function serializeEnvelope(envelope: Envelope<unknown>): string {
  return JSON.stringify(envelope);
}

/** 信封反序列化。 */
export function parseEnvelope(raw: string): Envelope<unknown> {
  return JSON.parse(raw) as Envelope<unknown>;
}

// —— 各消息类型便捷构造器 ——

export function encodeBlockBroadcast(
  block: Block,
  from: string,
  to: string,
): Envelope<BlockBroadcastPayload> {
  return encodeMemoryMessage<BlockBroadcastPayload>(
    'memory.block_broadcast',
    { block },
    from,
    to,
  );
}

export function encodeBlockRequest(
  fromIndex: number,
  from: string,
  to: string,
  toIndex?: number,
): Envelope<BlockRequestPayload> {
  const payload: BlockRequestPayload = { from_index: fromIndex };
  if (toIndex !== undefined) payload.to_index = toIndex;
  return encodeMemoryMessage<BlockRequestPayload>(
    'memory.block_request',
    payload,
    from,
    to,
  );
}

export function encodeBlockResponse(
  blocks: Block[],
  from: string,
  to: string,
): Envelope<BlockResponsePayload> {
  return encodeMemoryMessage<BlockResponsePayload>(
    'memory.block_response',
    { blocks },
    from,
    to,
  );
}

export function encodeChainSummary(
  summary: ChainSummary,
  from: string,
  to: string,
): Envelope<ChainSummaryPayload> {
  return encodeMemoryMessage<ChainSummaryPayload>(
    'memory.chain_summary',
    { summary },
    from,
    to,
  );
}

export function encodeBlockReject(
  reject: BlockRejectPayload,
  from: string,
  to: string,
): Envelope<BlockRejectPayload> {
  return encodeMemoryMessage<BlockRejectPayload>(
    'memory.block_reject',
    reject,
    from,
    to,
  );
}

export function encodeProofRequest(
  blockIndex: number,
  changeId: string,
  from: string,
  to: string,
): Envelope<ProofRequestPayload> {
  return encodeMemoryMessage<ProofRequestPayload>(
    'memory.proof_request',
    { block_index: blockIndex, change_id: changeId },
    from,
    to,
  );
}

export function encodeProofResponse(
  proof: MerkleProof,
  from: string,
  to: string,
): Envelope<ProofResponsePayload> {
  return encodeMemoryMessage<ProofResponsePayload>(
    'memory.proof_response',
    { proof },
    from,
    to,
  );
}
