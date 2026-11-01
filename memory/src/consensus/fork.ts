/**
 * 分叉解决：最长链 + 确定性 tie-break。
 *
 * 规则：
 *   1) 最长链优先（tip 最靠前的链）。
 *   2) 同长度分叉：在首个分歧 index 处比较 block.hash 字典序（ASCII 码序），取小者。
 * 全网统一、无随机性，保证确定性收敛。丢分支不自动覆盖、不删除数据（返回 orphan 列表）。
 */
import type { Block } from '../types/block';

/** 从候选链中选出主链。 */
export function chooseMainChain(candidates: Block[][]): Block[] {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort(compareChains);
  return sorted[0]!;
}

/** 链比较器：长度降序，长度相同则按首个分歧 index 的 hash 字典序取小。 */
function compareChains(a: Block[], b: Block[]): number {
  if (a.length !== b.length) return b.length - a.length;

  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ha = a[i]!.hash;
    const hb = b[i]!.hash;
    if (ha !== hb) {
      return ha < hb ? -1 : 1;
    }
  }
  return 0;
}

/** 选主链 + 收集 orphan 分支（不覆盖、不删除）。 */
export function selectFork(candidates: Block[][]): {
  main: Block[];
  orphans: Block[][];
} {
  const sorted = [...candidates].sort(compareChains);
  const main = sorted[0] ?? [];
  const orphans = sorted.slice(1);
  return { main, orphans };
}

/** 判断某链是否为主链。 */
export function isMainChain(chain: Block[], candidates: Block[][]): boolean {
  const main = chooseMainChain(candidates);
  if (chain.length !== main.length) return false;
  return chain.every((block, i) => main[i]!.hash === block.hash);
}
