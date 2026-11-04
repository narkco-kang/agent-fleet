/**
 * BM25 检索索引（无外部依赖）。
 *
 * 标准 BM25 评分：score(q,d) = Σ idf(t) * tf(t,d) * (k1+1) / (tf(t,d) + k1 * (1 - b + b * |d|/avgdl))
 * 借鉴 AgentMemory 的 keyless 关键词检索（BM25 是它 keyless 模式的核心，84.7% 召回）。
 */

interface Bm25Doc {
  id: string;
  tokens: string[];
  length: number;
}

export interface SearchHit {
  id: string;
  score: number;
}

export class Bm25Index {
  private docs: Bm25Doc[] = [];
  private docFreq = new Map<string, number>();
  private avgLen = 0;

  constructor(
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {}

  /** 加入一篇文档（幂等：同 id 覆盖）。 */
  add(id: string, tokens: string[]): void {
    this.remove(id);
    const length = tokens.length;
    this.docs.push({ id, tokens, length });
    const seen = new Set(tokens);
    for (const t of seen) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    this.recomputeAvgLen();
  }

  /** 移除一篇文档（供 supersede/expire 后重建索引）。 */
  remove(id: string): void {
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return;
    const [doc] = this.docs.splice(idx, 1);
    const seen = new Set(doc.tokens);
    for (const t of seen) {
      const n = (this.docFreq.get(t) ?? 0) - 1;
      if (n <= 0) this.docFreq.delete(t);
      else this.docFreq.set(t, n);
    }
    this.recomputeAvgLen();
  }

  private recomputeAvgLen(): void {
    this.avgLen = this.docs.length
      ? this.docs.reduce((n, d) => n + d.length, 0) / this.docs.length
      : 0;
  }

  /** 检索：返回 top-k 命中（按 score 降序）。 */
  search(queryTokens: string[], limit = 10): SearchHit[] {
    const N = this.docs.length;
    if (N === 0) return [];

    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      const termFreq = new Map<string, number>();
      for (const t of d.tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

      let score = 0;
      for (const qt of new Set(queryTokens)) {
        const tf = termFreq.get(qt);
        if (!tf) continue;
        const df = this.docFreq.get(qt) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = tf + this.k1 * (1 - this.b + this.b * (d.length / this.avgLen));
        score += (idf * (tf * (this.k1 + 1))) / denom;
      }
      if (score > 0) hits.push({ id: d.id, score });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /** 清空全部文档（重建索引前调用）。 */
  clear(): void {
    this.docs = [];
    this.docFreq.clear();
    this.avgLen = 0;
  }

  /** 文档数。 */
  size(): number {
    return this.docs.length;
  }
}
