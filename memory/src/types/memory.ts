/**
 * 记忆节点 / 边 / 证据类型与枚举常量。
 *
 * 常量对齐 amg `const.py`（NODE_TYPES / STATUSES / EDGE_KINDS / LOCATOR_PREFIXES），
 * 但这里只做「语义类型声明」，不依赖 amg 运行时代码。
 */

/** amg 节点类型（对齐 const.py NODE_TYPES）。 */
export const NODE_TYPES = [
  'group',
  'member',
  'task',
  'decision',
  'artifact',
  'issue',
  'model',
  'env',
  'question',
  'rule',
  'handoff',
] as const;

/** 节点类型字面量联合。 */
export type NodeType = (typeof NODE_TYPES)[number];

/** amg 节点状态（对齐 const.py STATUSES）。 */
export const STATUSES = [
  'proposed',
  'open',
  'in_progress',
  'done',
  'blocked',
  'superseded',
] as const;

/** 节点状态字面量联合。 */
export type Status = (typeof STATUSES)[number];

/** amg 边类型（对齐 const.py EDGE_KINDS）。 */
export const EDGE_KINDS = [
  'depends_on',
  'blocks',
  'produced_by',
  'owned_by',
  'decided_by',
  'supersedes',
  'relates_to',
  'part_of',
] as const;

/** 边类型字面量联合。 */
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** 结论型节点类型（对齐 const.py CONCLUSION_TYPES）。 */
export const CONCLUSION_TYPES = ['decision', 'artifact'] as const;

/** 证据定位符前缀（对齐 const.py LOCATOR_PREFIXES）。 */
export const LOCATOR_PREFIXES = ['path:', 'cmd:', 'url:', 'sha256:'] as const;

/** 定位符前缀字面量联合。 */
export type LocatorPrefix = (typeof LOCATOR_PREFIXES)[number];

/** 供 O(1) 成员判断使用的集合视图（对齐 amg 的 Python set 语义）。 */
export const NODE_TYPE_SET: ReadonlySet<string> = new Set<string>(NODE_TYPES);
export const STATUS_SET: ReadonlySet<string> = new Set<string>(STATUSES);
export const EDGE_KIND_SET: ReadonlySet<string> = new Set<string>(EDGE_KINDS);
export const LOCATOR_PREFIX_SET: ReadonlySet<string> = new Set<string>(
  LOCATOR_PREFIXES,
);

/** 证据对象（对齐 amg gate.py 的 evidence 结构）。 */
export interface Evidence {
  /** 前缀 path:/cmd:/url:/sha256: 的产物定位符。 */
  locator: string;
  /** 被引用产物的 sha256（64 位小写 hex，绝不能是节点 id/rev）。 */
  content_sha256: string;
  /** 捕获时间 ISO-8601。 */
  captured_at: string;
  /** 捕获时 rev（默认当前）。 */
  graph_rev?: number;
  /** 验证强度 1..5，与检索质量分离。 */
  grade?: number;
}

/** 记忆节点（对齐 amg node）。 */
export interface MemoryNode {
  id: string;
  type: string;
  label: string;
  status: string;
  /** 来源，拒绝 unknown/manual。 */
  source: string;
  owner?: string;
  note?: string;
  evidence: Evidence[];
  /** 是否结论型（decision/artifact）。 */
  conclusion?: boolean;
  /** 事实有效期窗口（由调用方提供，绝不默认成写入时间）。 */
  valid_from?: string;
  valid_until?: string;
  recorded_at?: string;
  superseded_at?: string;
}

/** 记忆边（对齐 amg edge）。 */
export interface MemoryEdge {
  from: string;
  to: string;
  kind: string;
}
