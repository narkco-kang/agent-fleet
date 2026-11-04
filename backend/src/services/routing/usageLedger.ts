import { randomId } from '../../security/auth.js';
import { estimateCostUsd } from '@agentfleet/shared';
import { insertUsage, listUsage, usageSummary } from '../../db/repo/usage.js';

/**
 * token 台账（借鉴 modelgateway ledger.jsonl 思路，落 usage_records 表）。
 *
 * P1-7：每条记录按模型价格估算成本（USD），未知模型/免费源估值为 0。
 */

export interface UsageInput {
  taskId?: string | null;
  provider?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

/** 记录一条台账 */
export function recordUsage(input: UsageInput): string {
  const recordId = randomId('usage');
  insertUsage({
    recordId,
    taskId: input.taskId ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    tokensIn: input.tokensIn ?? null,
    tokensOut: input.tokensOut ?? null,
    cost: estimateCostUsd(input.model, input.tokensIn, input.tokensOut),
  });
  return recordId;
}

/** 台账列表 */
export function listUsageRecords(limit = 500) {
  return listUsage(limit);
}

/** 台账摘要 */
export function getUsageSummary() {
  return usageSummary();
}
