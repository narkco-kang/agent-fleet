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

  /** 加入一个 change（幂等：同 id 覆盖）。 */
  add(change: MemoryChange): void {
    this.changes.set(change.id, change);
    const text = changeText(change);
    if (text) this.bm25.add(change.id, tokenize(text));
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
  }

  /** 关键词召回：返回 top-k 命中（按 score 降序）。 */
  search(query: string, limit = 10): MemorySearchHit[] {
    return this.bm25
      .search(tokenize(query), limit)
      .map((h): MemorySearchHit | null => {
        const change = this.changes.get(h.id);
        return change ? { change, score: h.score } : null;
      })
      .filter((h): h is MemorySearchHit => h !== null);
  }

  /** 从已有 change 批量重建（启动时从账本回放）。 */
  rebuild(changes: MemoryChange[]): void {
    this.changes.clear();
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

    return Array.from(rrf.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]): MemorySearchHit | null => {
        const change = this.changes.get(id);
        return change ? { change, score } : null;
      })
      .filter((h): h is MemorySearchHit => h !== null);
  }

  /**
   * 三重混合检索（P0-1）：BM25（关键词）+ 语义向量（cosine）+ Jaccard（字符相似）
   * 三路 Reciprocal Rank Fusion 融合。向量未就绪（模型加载中/失败）时降级为 BM25 + Jaccard。
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

    return Array.from(rrf.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]): MemorySearchHit | null => {
        const change = this.changes.get(id);
        return change ? { change, score } : null;
      })
      .filter((h): h is MemorySearchHit => h !== null);
  }

  size(): number {
    return this.bm25.size();
  }
}

export type { SearchHit };
