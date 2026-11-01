import type { FreeSourceRating } from './status.js';

/**
 * 免费源评级（优 > 中 > 差）。
 * - 优：请求成功且响应快（< 1500ms）
 * - 中：请求成功但响应慢（>= 1500ms）
 * - 差：请求失败，或额度受限（429 等当前不可用）
 * 仅保留优与中。
 */
export function computeRating(opts: {
  ok: boolean;
  latencyMs: number;
  quotaLimited?: boolean;
}): FreeSourceRating {
  if (!opts.ok) return 'poor';
  if (opts.quotaLimited) return 'poor';
  return opts.latencyMs < 1500 ? 'excellent' : 'medium';
}

export const RATING_LABEL: Record<FreeSourceRating, string> = {
  excellent: '优',
  medium: '中',
  poor: '差',
};

/** 是否保留（优或中） */
export function keepRating(rating: FreeSourceRating): boolean {
  return rating === 'excellent' || rating === 'medium';
}
