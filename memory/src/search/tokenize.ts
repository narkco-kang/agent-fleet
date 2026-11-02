/**
 * 中英文分词（无外部依赖，纯 TS）。
 *
 * - 英文/数字：按 `[a-z0-9]+` 切词 + 小写
 * - 中文：CJK 字符做 unigram（单字）+ bigram（双字），不依赖 jieba 等重依赖
 *
 * 借鉴 AgentMemory 的 keyless BM25 思路：无 API key 也能做关键词召回。
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
const WORD_RE = /[a-z0-9]+/g;

/** 把一个文本切成检索 token（小写）。 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // 英文/数字词
  for (const w of lower.match(WORD_RE) ?? []) tokens.push(w);

  // 中文：unigram + bigram（bigram 覆盖常用双字词，如「登录」「超时」）
  const cjk = Array.from(lower.match(CJK_RE) ?? []);
  for (const c of cjk) tokens.push(c);
  for (let i = 0; i + 1 < cjk.length; i++) tokens.push(cjk[i] + cjk[i + 1]);

  return tokens;
}
