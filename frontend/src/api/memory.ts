import { get, type ApiOk } from './http';

/**
 * 记忆账本 API：摘要 + 语义检索 + 相似记忆。
 */

/** 账本摘要（GET /api/memory/summary） */
export interface MemorySummary {
  group: string;
  schema: string;
  blocks: number;
  changes: number;
  tipIndex: number;
  tipHash: string;
  healthy: boolean;
  error: string | null;
  indexed: number;
  updatedAt: string;
}

/** 一条记忆 change（账本里的记录） */
export interface MemoryChange {
  id: string;
  op: string;
  target: string;
  by: string;
  at: string;
  rev: number;
  note: string;
  status?: string;
}

/** 检索命中 */
export interface MemorySearchHit {
  change: MemoryChange;
  score: number;
}

/** 记忆整合洞察（四层整合的 Semantic 层统计） */
export interface MemoryFacts {
  total: number;
  completed: number;
  failed: number;
  successRate: number | null;
  byStatus: Record<string, number>;
  byAgent: Record<string, number>;
  byDevice: Record<string, number>;
  recent: Array<{ note: string; status?: string; at: string }>;
  lessons: Array<{ note: string; at: string }>;
}

export const memoryApi = {
  /** 账本摘要 + 健康状态 */
  summary: () => get<MemorySummary>('/api/memory/summary'),

  /** 记忆整合洞察（统计事实 + 失败教训） */
  facts: () => get<MemoryFacts>('/api/memory/facts'),

  /** 语义召回（关键词搜索记忆） */
  search: (q: string, limit = 10) =>
    get<ApiOk<{ mode: string; data: MemorySearchHit[] }>>(
      `/api/memory/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  /** 相似记忆（近重复检测） */
  similar: (text: string, limit = 5) =>
    get<ApiOk<{ data: MemorySearchHit[] }>>(
      `/api/memory/similar?text=${encodeURIComponent(text)}&limit=${limit}`,
    ),
};

export type { MemorySummary as MemorySummaryType };
