import type { ActionKind, ActionStatus } from './status.js';

/**
 * 人工确认开关协议（横切安全红线）。
 * 对外动作（deploy / asset_deliver / loop_start）统一先 request → confirm 再放行。
 */

/** 人工确认记录 */
export interface ActionConfirmation {
  id: string;
  kind: ActionKind;
  /** 关联 batchId / deliveryId / loopId */
  refId: string;
  status: ActionStatus;
  /** 展示给用户确认的摘要（不含密码） */
  payloadSummary: string;
  createdAt: number;
  confirmedAt?: number;
  confirmedBy?: string;
}
