/**
 * 记忆语义检索：对 MemoryChange 的文本内容建 BM25 索引，支持关键词召回。
 *
 * 这是借鉴 AgentMemory 引入的核心能力——给 append-only 账本补「召回」层：
 * 账本仍是防篡改的哈希链（不变），但在其上加一个可重建的检索索引（可变、可丢弃）。
 */
import type { MemoryChange } from '../types';
import { Bm25Index, type SearchHit } from './bm25';
import { tokenize } from './tokenize';

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

  /** 加入一个 change（幂等：同 id 覆盖）。 */
  add(change: MemoryChange): void {
    this.changes.set(change.id, change);
    const text = changeText(change);
    if (text) this.bm25.add(change.id, tokenize(text));
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

  size(): number {
    return this.bm25.size();
  }
}

export type { SearchHit };
