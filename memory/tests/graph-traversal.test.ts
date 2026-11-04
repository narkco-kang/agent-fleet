import { describe, expect, it } from 'vitest';
import { MemoryGraph } from '../src/search/graph-traversal.js';
import { MemorySearchIndex } from '../src/search/memory-index.js';
import type { MemoryChange } from '../src/types/block.js';

/**
 * docs/25 图遍历检索（实体匹配 → 图遍历）：从 add_node/add_edge 构建邻接图，
 * query 匹配节点 → BFS 沿边召回图结构相邻节点。
 */

function nodeChange(id: string, label: string, note = ''): MemoryChange {
  return {
    id: `ch-${id}`,
    op: 'add_node',
    target: id,
    by: 'coordinator',
    at: new Date().toISOString(),
    rev: 1,
    note,
    node: {
      id,
      type: 'artifact',
      label,
      status: 'done',
      source: 'task',
      evidence: [],
    },
  };
}

function edgeChange(id: string, from: string, to: string, kind = 'relates_to'): MemoryChange {
  return {
    id: `ch-edge-${id}`,
    op: 'add_edge',
    target: `${from}->${to}`,
    by: 'coordinator',
    at: new Date().toISOString(),
    rev: 1,
    note: '',
    edge: { from, to, kind },
  };
}

describe('图遍历检索（MemoryGraph）', () => {
  it('实体匹配：query token 命中节点 label', () => {
    const g = new MemoryGraph();
    g.addChange(nodeChange('a', '登录接口实现'));
    g.addChange(nodeChange('b', '数据库迁移脚本'));

    const starts = g.matchEntities('登录');
    expect(starts).toEqual(['a']);
  });

  it('图遍历：从匹配节点 BFS 召回相邻节点', () => {
    const g = new MemoryGraph();
    g.addChange(nodeChange('a', '登录接口'));
    g.addChange(nodeChange('b', '用户表 schema'));
    g.addChange(nodeChange('c', '无关的文档'));
    g.addChange(edgeChange('e1', 'a', 'b')); // a-b 相邻
    // c 孤立

    const hits = g.search('登录', 1, 20);
    const ids = hits.map((h) => h.nodeId).sort();
    expect(ids).toContain('a'); // 实体匹配
    expect(ids).toContain('b'); // 图遍历邻居
    expect(ids).not.toContain('c'); // 孤立节点不召回
  });

  it('深度标记：匹配节点 depth=0 matched，邻居 depth>0', () => {
    const g = new MemoryGraph();
    g.addChange(nodeChange('a', '登录接口'));
    g.addChange(nodeChange('b', '用户表 schema'));
    g.addChange(edgeChange('e1', 'a', 'b'));

    const hits = g.search('登录', 2, 20);
    const a = hits.find((h) => h.nodeId === 'a');
    const b = hits.find((h) => h.nodeId === 'b');
    expect(a?.matched).toBe(true);
    expect(a?.depth).toBe(0);
    expect(b?.matched).toBe(false);
    expect(b?.depth).toBe(1);
  });

  it('无匹配返回空', () => {
    const g = new MemoryGraph();
    g.addChange(nodeChange('a', '登录接口'));
    expect(g.search('不存在的词xyz').length).toBe(0);
  });

  it('removeChange 删除节点后不再召回', () => {
    const g = new MemoryGraph();
    g.addChange(nodeChange('a', '登录接口'));
    g.removeChange('ch-a');
    expect(g.matchEntities('登录')).toEqual([]);
    expect(g.size()).toBe(0);
  });
});

describe('MemorySearchIndex 图检索集成', () => {
  it('graphSearch 从 add_node/add_edge 召回图邻居', () => {
    const idx = new MemorySearchIndex();
    idx.add(nodeChange('a', '登录接口'));
    idx.add(nodeChange('b', 'JWT 鉴权中间件'));
    idx.add(edgeChange('e1', 'a', 'b'));

    const hits = idx.graphSearch('登录', 1, 10);
    const ids = hits.map((h) => h.nodeId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(idx.graphSize()).toBe(2);
  });

  it('rebuild 后图索引正确重建', () => {
    const idx = new MemorySearchIndex();
    idx.add(nodeChange('a', '登录接口'));
    idx.add(nodeChange('b', '用户表'));
    idx.add(edgeChange('e1', 'a', 'b'));

    idx.rebuild([
      nodeChange('a', '登录接口'),
      nodeChange('b', '用户表'),
      edgeChange('e1', 'a', 'b'),
    ]);
    const hits = idx.graphSearch('登录', 1, 10);
    expect(hits.map((h) => h.nodeId)).toContain('b');
    expect(idx.graphSize()).toBe(2);
  });
});
