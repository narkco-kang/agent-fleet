/**
 * 记忆语义检索：对 MemoryChange 的文本内容建 BM25 索引，支持关键词召回。
 *
 * 这是借鉴 AgentMemory 引入的核心能力——给 append-only 账本补「召回」层：
 * 账本仍是防篡改的哈希链（不变），但在其上加一个可重建的检索索引（可变、可丢弃）。
 */
import type { MemoryChange } from '../types';
import { Bm25Index, type SearchHit } from './bm25';
import { tokenize } from './tokenize';
import { findSimilar, type SimilarHit } from './similarity';
import { embed, cosine } from '../semantic/embedder';
import { MemoryGraph, type GraphHit } from './graph-traversal';
import { decayWeight, ageSince, DEFAULT_DECAY, type DecayConfig } from '../semantic/decay';

/** 提取 change 的可检索文本（target + note + node 的 label/note/source）。 */
export function changeText(change: MemoryChange): string {
  const parts: string[] = [change.target, change.note];
  if (change.node) {
    parts.push(change.node.label, change.node.note ?? '', change.node.source);
  }
  if (change.edge) {
    parts.push(change.edge.kind, `${change.edge.from}->${change.edge.to}`);
  }
  return parts.filter((p) => p && p.trim().length > 0).join(' ');
}

export interface MemorySearchHit {
  change: MemoryChange;
  score: number;
}

export class MemorySearchIndex {
  private readonly bm25 = new Bm25Index();
  private readonly changes = new Map<string, MemoryChange>();
  /** change.id → 语义向量（异步懒生成，缺失时向量路降级） */
  private readonly vectors = new Map<string, number[]>();
  private vectorsReady = false;
  /** 图检索（实体匹配 → 图遍历），从 add_node/add_edge 构建，可重建 */
  private readonly graph = new MemoryGraph();
  /** change.id → 累计被检索命中次数（访问加强，docs/25 衰减/加强） */
  private readonly accessCount = new Map<string, number>();
  /** 遗忘衰减配置（可运行时调整，不影响账本） */
  private decayConfig: DecayConfig = { ...DEFAULT_DECAY };

  /** 调整遗忘衰减配置（半衰期 / 访问加强系数）。 */
  setDecay(config: Partial<DecayConfig>): void {
    this.decayConfig = { ...this.decayConfig, ...config };
  }

  /** 记录一次检索命中（访问加强：常召回的记忆保持高权重）。 */
  private recordAccess(id: string): void {
    this.accessCount.set(id, (this.accessCount.get(id) ?? 0) + 1);
  }

  /**
   * 统一收尾：对候选分数应用遗忘衰减（时间半衰期 + 访问加强），记录访问，排序截断。
   * 只影响检索排序权重，绝不删账本。
   */
  private finalize(scores: Map<string, number>, limit: number): MemorySearchHit[] {
    const out: MemorySearchHit[] = [];
    for (const [id, rawScore] of scores) {
      const change = this.changes.get(id);
      if (!change) continue;
      const age = ageSince(change.at);
      const access = this.accessCount.get(id) ?? 0;
      const score = rawScore * decayWeight(age, access, this.decayConfig);
      out.push({ change, score });
    }
    out.sort((a, b) => b.score - a.score);
    const top = out.slice(0, limit);
    for (const h of top) this.recordAccess(h.change.id);
    return top;
  }

  /** 加入一个 change（幂等：同 id 覆盖）。 */
  add(change: MemoryChange): void {
    this.changes.set(change.id, change);
    const text = changeText(change);
    if (text) this.bm25.add(change.id, tokenize(text));
    this.graph.addChange(change);
    // 异步生成语义向量（fire-and-forget，不阻塞入索引）
    void this.embedChange(change.id, text);
  }

  /** 单个 change 的向量生成（懒加载模型，失败静默降级） */
  private async embedChange(id: string, text: string): Promise<void> {
    const vecs = await embed([text]);
    if (vecs && vecs[0]) this.vectors.set(id, vecs[0]);
    if (!this.vectorsReady && vecs) this.vectorsReady = true;
  }

  /** 移除一个 change（supersede/expire 后重建）。 */
  remove(id: string): void {
    this.changes.delete(id);
    this.bm25.remove(id);
    this.graph.removeChange(id);
  }

  /** 关键词召回：返回 top-k 命中（按 score 降序，应用遗忘衰减）。 */
  search(query: string, limit = 10): MemorySearchHit[] {
    const scores = new Map<string, number>();
    this.bm25.search(tokenize(query), limit).forEach((h) => scores.set(h.id, h.score));
    return this.finalize(scores, limit);
  }

  /** 从已有 change 批量重建（启动时从账本回放）。 */
  rebuild(changes: MemoryChange[]): void {
    this.changes.clear();
    this.bm25.clear();
    this.graph.clear();
    this.vectors.clear();
    this.accessCount.clear();
    for (const c of changes) this.add(c);
  }

  /**
   * 相似记忆检测：找与 query 文本 Jaccard 相似度 >= threshold 的 change。
   * 用于写入前近重复提示 + 相似记忆推荐（借鉴 AgentMemory 的 similarTo）。
   */
  findSimilar(query: string, threshold = 0.6, limit = 5): SimilarHit<MemoryChange>[] {
    const candidates = Array.from(this.changes.values()).map((c) => ({
      item: c,
      text: changeText(c),
    }));
    return findSimilar(query, candidates, threshold, limit);
  }

  /**
   * 混合检索（RRF 融合）：把 BM25（关键词）+ Jaccard（字符相似）两个信号
   * 用 Reciprocal Rank Fusion 融合排序，比单一 BM25 更能召回「措辞不同但语义相似」的记忆。
   * 借鉴 AgentMemory 的三重检索 RRF 融合（k=60）。
   */
  hybridSearch(query: string, limit = 10): MemorySearchHit[] {
    const K = 60;
    const rrf = new Map<string, number>();

    // 信号 1：BM25 关键词
    this.bm25.search(tokenize(query), 50).forEach((h, i) => {
      rrf.set(h.id, (rrf.get(h.id) ?? 0) + 1 / (K + i + 1));
    });

    // 信号 2：Jaccard 字符相似（阈值 0 拿全部，靠 RRF 统一排序）
    const candidates = Array.from(this.changes.values()).map((c) => ({
      item: c,
      text: changeText(c),
    }));
    findSimilar(query, candidates, 0, 50).forEach((h, i) => {
      rrf.set(h.item.id, (rrf.get(h.item.id) ?? 0) + 1 / (K + i + 1));
    });

    return this.finalize(rrf, limit);
  }

  /**
   * 四重混合检索（P0-1 + P2 图检索）：BM25（关键词）+ 语义向量（cosine）+ Jaccard（字符相似）
   * + 图遍历（实体匹配 + 邻居），四路 Reciprocal Rank Fusion 融合。
   * 向量未就绪（模型加载中/失败）时降级为 BM25 + Jaccard + 图。
   */
  async hybridSearchAsync(query: string, limit = 10): Promise<MemorySearchHit[]> {
    const K = 60;
    const rrf = new Map<string, number>();

    // 信号 1：BM25 关键词
    this.bm25.search(tokenize(query), 50).forEach((h, i) => {
      rrf.set(h.id, (rrf.get(h.id) ?? 0) + 1 / (K + i + 1));
    });

    // 信号 2：语义向量（cosine 相似，降序）
    const qv = await embed([query]);
    if (qv && qv[0] && this.vectors.size > 0) {
      const ranked = Array.from(this.vectors.entries())
        .map(([id, vec]) => ({ id, sim: cosine(qv[0]!, vec) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 50);
      ranked.forEach((r, i) => {
        rrf.set(r.id, (rrf.get(r.id) ?? 0) + 1 / (K + i + 1));
      });
    }

    // 信号 3：Jaccard 字符相似（阈值 0 拿全部，靠 RRF 统一排序）
    const candidates = Array.from(this.changes.values()).map((c) => ({
      item: c,
      text: changeText(c),
    }));
    findSimilar(query, candidates, 0, 50).forEach((h, i) => {
      rrf.set(h.item.id, (rrf.get(h.item.id) ?? 0) + 1 / (K + i + 1));
    });

    // 信号 4：图遍历（实体匹配 + 图结构相邻节点召回）
    this.graph.search(query, 2, 50).forEach((h, i) => {
      rrf.set(h.changeId, (rrf.get(h.changeId) ?? 0) + 1 / (K + i + 1));
    });

    return this.finalize(rrf, limit);
  }

  /** 图遍历检索（实体匹配 → BFS 图遍历），返回命中（含深度与匹配标记）。 */
  graphSearch(query: string, maxDepth = 2, limit = 20): GraphHit[] {
    return this.graph.search(query, maxDepth, limit);
  }

  /** 按 change.id 取 change（供图检索命中映射回完整 change）。 */
  getChange(id: string): MemoryChange | undefined {
    return this.changes.get(id);
  }

  /** 图节点规模（供诊断）。 */
  graphSize(): number {
    return this.graph.size();
  }

  size(): number {
    return this.bm25.size();
  }
}

export type { SearchHit };
