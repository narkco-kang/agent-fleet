/**
 * 蜂群间记忆同步装配层（backend leader 侧）。
 *
 * - setupMemorySync：memoryLedger 出块后广播给所有在线设备（中心广播，星形 gossip 退化）
 * - handleMemorySyncMessage：处理设备上行的 chain_summary（上报链头）与 block_request（主动拉取），
 *   落后则回 block_response 补齐
 *
 * 复用现有传输层 sendToDevice（直连 socket 或中继转发），不新建通道。
 */
import { deviceRegistry } from './deviceRegistry.js';
import { sendToDevice } from '../transport/wsServer.js';
import { memoryLedger } from './memoryLedger.js';
import { MESSAGE_TYPES, type Envelope as SharedEnvelope } from '@agentfleet/shared';
import { encodeBlockBroadcast, encodeBlockResponse } from '@agentfleet/memory';
import type { ChainSummary } from '@agentfleet/memory';

/** memory 的 Envelope 与 shared 的 Envelope 结构一致，桥接类型（type 字段均为字符串字面量）。 */
const asShared = <T>(env: T): SharedEnvelope => env as unknown as SharedEnvelope;

/** 装配出块广播：memoryLedger 出块 → 遍历在线设备 → sendToDevice 广播新区块。 */
export function setupMemorySync(): void {
  memoryLedger.setOnBlock((block) => {
    for (const deviceId of deviceRegistry.onlineIds()) {
      sendToDevice(deviceId, asShared(encodeBlockBroadcast(block, 'coordinator', deviceId)));
    }
  });
}

/** 处理设备上行的记忆同步消息。 */
export async function handleMemorySyncMessage(
  type: string,
  fromDeviceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (type === MESSAGE_TYPES.MEMORY_CHAIN_SUMMARY) {
    // 设备上报己方链头，落后则回 block_response 补齐
    const summary = payload.summary as ChainSummary;
    const blocks = await memoryLedger.getBlocksAfter(summary.tip_index);
    if (blocks.length > 0) {
      sendToDevice(fromDeviceId, asShared(encodeBlockResponse(blocks, 'coordinator', fromDeviceId)));
    }
    return;
  }

  if (type === MESSAGE_TYPES.MEMORY_BLOCK_REQUEST) {
    // 设备主动拉取 [from, to] 区间区块
    const from = Number(payload.from_index);
    const to = payload.to_index === undefined ? undefined : Number(payload.to_index);
    const blocks = await memoryLedger.getBlocksBetween(from, to);
    if (blocks.length > 0) {
      sendToDevice(fromDeviceId, asShared(encodeBlockResponse(blocks, 'coordinator', fromDeviceId)));
    }
  }
}
