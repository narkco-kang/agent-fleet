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
  /** Mandate/policyVersion：受理时锁住的策略版本（DSH 融合） */
  policyVersion?: string;
  /** 策略变更后对在途单的通知（结构化 Reason JSON），不撤销已给授权 */
  policyNotice?: string;
  /** 拒绝/复检失败的结构化原因（Reason JSON），诚实报告而非静默丢弃 */
  reason?: string;
}
