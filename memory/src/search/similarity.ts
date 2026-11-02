/**
 * 相似度计算（纯 TS，无依赖）：token 级 Jaccard。
 *
 * 借鉴 AgentMemory 的「近重复提示」——保存时若内容与现有记忆高度相似，返回 similarTo。
 * 用途：① 写入前近重复检测（避免账本膨胀）② 相似记忆推荐（"这条记忆跟历史哪几条很像"）。
 *
 * 用 token 级（复用 tokenize 分词）而非字符 n-gram：对中英文短文本更鲁棒，
 * 避免「的 bug」这类尾部字符把相似度拉低。
 */
import { tokenize } from './tokenize';

/** 两个文本的 Jaccard 相似度（0~1，基于分词 token 集合）。 */
export function jaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export interface SimilarHit<T> {
  item: T;
  score: number;
}

/**
 * 在一组候选中找与 query 相似度 >= threshold 的项（按相似度降序）。
 * 注意：O(n) 全扫，适用于中小规模记忆；超大规模应换局部敏感哈希（后续）。
 */
export function findSimilar<T>(
  query: string,
  candidates: Array<{ item: T; text: string }>,
  threshold = 0.6,
  limit = 5,
): SimilarHit<T>[] {
  const hits: SimilarHit<T>[] = [];
  for (const c of candidates) {
    const score = jaccard(query, c.text);
    if (score >= threshold) hits.push({ item: c.item, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
