/**
 * 记忆遗忘衰减 + 访问加强（docs/25 落地清单第 3 项）。
 *
 * 只作用于检索排序权重（旧记忆/少访问降权），绝不删账本——append-only 防篡改不变。
 * 借鉴 AgentMemory 的「衰减/加强」：时间半衰期 + 访问频率加强。
 *
 *   - 时间衰减：越久远的记忆权重越低（半衰期可配，默认 7 天）
 *   - 访问加强：被检索命中越频繁的记忆权重越高（常召回的记忆保持活跃）
 */

export interface DecayConfig {
  /** 时间半衰期（毫秒），默认 7 天。半衰期越短，旧记忆衰减越快。 */
  halfLifeMs: number;
  /** 访问加强系数（对数平滑），默认 0.5。 */
  accessBoost: number;
}

export const DEFAULT_DECAY: DecayConfig = {
  halfLifeMs: 7 * 24 * 3600 * 1000,
  accessBoost: 0.5,
};

/**
 * 计算一条记忆的衰减权重（0..∞，1 = 不衰减）。
 * @param ageMs 距写入的毫秒数
 * @param accessCount 被检索命中的累计次数
 */
export function decayWeight(ageMs: number, accessCount: number, config: DecayConfig = DEFAULT_DECAY): number {
  const clampedAge = Math.max(0, ageMs);
  // 时间衰减：半衰期模型，age=0 → 1，age=halfLife → 0.5，age→∞ → 0
  const timeDecay = 1 / (1 + clampedAge / config.halfLifeMs);
  // 访问加强：log(1+n) 平滑，避免线性爆炸
  const accessBoost = 1 + config.accessBoost * Math.log(1 + Math.max(0, accessCount));
  return timeDecay * accessBoost;
}

/** 从 ISO-8601 时间戳计算 age（毫秒），无效时间按 0 处理（不衰减）。 */
export function ageSince(at: string, now = Date.now()): number {
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, now - t);
}
