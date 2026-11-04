/**
 * 模型定价与成本估算（P1-7）。
 *
 * 单位：美元 / 每百万 token（USD per 1M tokens）。仅覆盖常见付费模型；
 * 免费源/未知模型估值为 0（成本不透明，不虚报）。
 *
 * 匹配策略：先精确匹配，再按「前缀包含」兜底（如 gpt-4o-2024-08-06 命中 gpt-4o）。
 */

export interface TokenPriceUsd {
  /** 输入价格（USD / 1M tokens） */
  inputPerM: number;
  /** 输出价格（USD / 1M tokens） */
  outputPerM: number;
}

/** 常见付费模型价格表（USD / 1M tokens，2025 官方公开价，仅作成本估算口径） */
export const MODEL_PRICING_USD: Record<string, TokenPriceUsd> = {
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4.1': { inputPerM: 2, outputPerM: 8 },
  'gpt-4.1-mini': { inputPerM: 0.4, outputPerM: 1.6 },
  'o3': { inputPerM: 2, outputPerM: 8 },
  'o3-mini': { inputPerM: 1.1, outputPerM: 4.4 },
  'claude-sonnet-4': { inputPerM: 3, outputPerM: 15 },
  'claude-opus-4': { inputPerM: 15, outputPerM: 75 },
  'claude-haiku': { inputPerM: 0.25, outputPerM: 1.25 },
  'claude-3-5-sonnet': { inputPerM: 3, outputPerM: 15 },
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
  'gemini-2.0-flash': { inputPerM: 0.1, outputPerM: 0.4 },
  'deepseek-chat': { inputPerM: 0.27, outputPerM: 1.1 },
  'deepseek-reasoner': { inputPerM: 0.55, outputPerM: 2.19 },
  'qwen-plus': { inputPerM: 0.4, outputPerM: 1.2 },
  'kimi-k2': { inputPerM: 0.6, outputPerM: 2.5 },
};

/** 前缀匹配兜底：模型名可能带版本/日期后缀 */
function findPrice(model: string | null | undefined): TokenPriceUsd | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (MODEL_PRICING_USD[m]) return MODEL_PRICING_USD[m];
  // 前缀包含匹配（gpt-4o-2024-08-06 → gpt-4o）
  const keys = Object.keys(MODEL_PRICING_USD).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (m.includes(k)) return MODEL_PRICING_USD[k];
  }
  return undefined;
}

/** 估算单条调用成本（美元），无定价/无 token 数时返回 0 */
export function estimateCostUsd(
  model: string | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): number {
  const p = findPrice(model);
  if (!p) return 0;
  const tin = tokensIn ?? 0;
  const tout = tokensOut ?? 0;
  return (tin / 1_000_000) * p.inputPerM + (tout / 1_000_000) * p.outputPerM;
}
