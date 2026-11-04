/**
 * 图遍历检索（docs/25 落地清单第 2 项：实体匹配 → 图遍历）。
 *
 * 从 add_node / add_edge 语义操作构建内存邻接图，query 先做「实体匹配」（token 命中
 * 节点 label/note/source），再从命中节点沿边 BFS 图遍历，把「图结构上相邻」的节点
 * 一并召回。作为检索的第四路信号融合进 RRF，补齐「三重检索」里缺失的图检索流。
 *
 * 只读内存图，可重建、可丢弃，绝不写账本、不破坏 append-only 防篡改。
 */
import type { MemoryChange } from '../types/block';
import { tokenize } from './tokenize';

/** 图检索命中（changeId 供映射回 MemoryChange）。 */
export interface GraphHit {
  /** 命中的 change.id（add_node 的 change）。 */
  changeId: string;
  /** 节点 id。 */
  nodeId: string;
  /** 距实体匹配起点的跳数（0 = 直接实体匹配）。 */
  depth: number;
  /** 是否实体直接匹配（false = 图遍历邻居）。 */
  matched: boolean;
}

export class MemoryGraph {
  /** node.id → { 检索文本（小写）, changeId }。 */
  private readonly nodes = new Map<string, { text: string; changeId: string }>();
  /** 邻接表（无向，边双向可达）。 */
  private readonly adjacency = new Map<string, Set<string>>();
  /** changeId → node.id（供 remove 定位节点）。 */
  private readonly changeToNode = new Map<string, string>();

  /** 加一个 change：add_node 记录节点，add_edge 记录边。 */
  addChange(change: MemoryChange): void {
    if (change.node) {
      const text = [
        change.node.label,
        change.node.note ?? '',
        change.node.source,
        change.node.type,
      ]
        .filter((p) => p && p.trim().length > 0)
        .join(' ')
        .toLowerCase();
      this.nodes.set(change.node.id, { text, changeId: change.id });
      this.changeToNode.set(change.id, change.node.id);
      if (!this.adjacency.has(change.node.id)) {
        this.adjacency.set(change.node.id, new Set());
      }
    }
    if (change.edge) {
      this.addEdge(change.edge.from, change.edge.to);
    }
  }

  /** 移除一个 change 对应的节点（边/邻接残留对召回影响小，不深删）。 */
  removeChange(changeId: string): void {
    const nodeId = this.changeToNode.get(changeId);
    if (nodeId) {
      this.nodes.delete(nodeId);
      this.changeToNode.delete(changeId);
    }
  }

  private addEdge(from: string, to: string): void {
    if (!from || !to || from === to) return;
    if (!this.adjacency.has(from)) this.adjacency.set(from, new Set());
    if (!this.adjacency.has(to)) this.adjacency.set(to, new Set());
    this.adjacency.get(from)!.add(to);
    this.adjacency.get(to)!.add(from);
  }

  /** 实体匹配：query token 命中节点检索文本，返回按命中数降序的起始节点 id。 */
  matchEntities(query: string, limit = 20): string[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const scored: Array<{ id: string; score: number }> = [];
    for (const [id, info] of this.nodes) {
      let score = 0;
      for (const t of tokens) {
        if (info.text.includes(t)) score += 1;
      }
      if (score > 0) scored.push({ id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.id);
  }

  /** BFS 图遍历：从起始节点出发，返回 nodeId → depth。 */
  traverse(startIds: string[], maxDepth = 2): Map<string, number> {
    const depth = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<[string, number]> = [];
    for (const id of startIds) {
      if (visited.has(id)) continue;
      visited.add(id);
      depth.set(id, 0);
      queue.push([id, 0]);
    }
    let head = 0;
    while (head < queue.length) {
      const [cur, d] = queue[head++];
      if (d >= maxDepth) continue;
      const neighbors = this.adjacency.get(cur);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        depth.set(nb, d + 1);
        queue.push([nb, d + 1]);
      }
    }
    return depth;
  }

  /** 组合检索：实体匹配 → 图遍历，返回 changeId 命中列表（浅层优先）。 */
  search(query: string, maxDepth = 2, limit = 20): GraphHit[] {
    const starts = this.matchEntities(query, limit);
    if (starts.length === 0) return [];
    const depths = this.traverse(starts, maxDepth);
    const out: GraphHit[] = [];
    for (const [nodeId, depth] of depths) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;
      out.push({ changeId: node.changeId, nodeId, depth, matched: depth === 0 });
    }
    // 匹配节点优先，其次深度浅优先，稳定排序
    out.sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      return a.depth - b.depth;
    });
    return out.slice(0, limit);
  }

  /** 清空整张图（重建索引前调用）。 */
  clear(): void {
    this.nodes.clear();
    this.adjacency.clear();
    this.changeToNode.clear();
  }

  /** 图节点数。 */
  size(): number {
    return this.nodes.size;
  }
}
