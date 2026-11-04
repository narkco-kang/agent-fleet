/**
 * 语义记忆分层抽取器（P1-1）。
 *
 * 把 append-only 的 change 流水，按 openJiuwen agent-memory 的五类语义记忆分层：
 *   profile（画像） / semantic（语义知识） / episodic（情景记忆）
 *   / variable（变量状态） / summary（摘要）
 *
 * 纯规则分类（TS 自研，零 LLM 依赖）：
 *   - 不进出块热路径（由 memoryLedger 出块后异步/按需触发）
 *   - 分类只作用在「检索/洞察层」，不写账本、不破坏 append-only 防篡改
 */
import type { MemoryChange } from '../types/block';

/** 五类语义记忆 */
export type SemanticCategory = 'profile' | 'semantic' | 'episodic' | 'variable' | 'summary';

export const SEMANTIC_CATEGORIES: readonly SemanticCategory[] = [
  'profile',
  'semantic',
  'episodic',
  'variable',
  'summary',
] as const;

/** 结构化语义事实 */
export interface SemanticFact {
  category: SemanticCategory;
  /** 主语（agent@device 或实体） */
  subject: string;
  /** 谓词/关系（状态或动作） */
  predicate: string;
  /** 宾语/值（prompt 摘要或数值） */
  object: string;
  /** 置信度 0..1（规则命中=1，兜底=0.5） */
  confidence: number;
  /** 来源 change id（可追溯） */
  sourceId: string;
}

/** 分类提示词（按优先级排序，命中即返回；全部小写匹配） */
const CATEGORY_HINTS: Array<{ category: SemanticCategory; hints: string[] }> = [
  {
    category: 'summary',
    hints: ['摘要', '总结', '概述', '交接', '回顾', '前序', '复盘', '本轮', '会话纪要'],
  },
  {
    category: 'profile',
    hints: ['偏好', '喜欢', '擅长', '定位', '习惯', '常用', '风格', '身份', '属于', '性格', '倾向'],
  },
  {
    category: 'variable',
    hints: [
      '余额', '计数', '额度', '阈值', '配额', '版本', '配置', '数值', '统计', '温度',
      'token', 'rate', 'limit', 'count', '状态=', '开关', '剩余',
    ],
  },
  {
    category: 'semantic',
    hints: [
      '结论', '规则', '协议', '架构', '设计', '原理', '事实', '原因', '应该', '必须',
      'api', '接口', '会', '返回', '支持', '约束', '约定', '最佳实践',
    ],
  },
];

/** 任务终态 note 形如 `agent@device 「prompt」 → result`，含 @ 或 → 或 「 */
function looksLikeTaskEvent(note: string): boolean {
  return /@|→|「|」/.test(note);
}

/**
 * 分类一条 change 到五类语义记忆（永不为 null，兜底 semantic/episodic 保证 100% 覆盖）。
 */
export function classifyChange(change: Pick<MemoryChange, 'note' | 'status' | 'op'>): SemanticCategory {
  const note = change.note ?? '';
  const lower = note.toLowerCase();

  // 1) 任务终态事件优先（status + note 形如 `agent@device 「prompt」 → result`）→ 情景记忆。
  //    结构特征比关键词更可靠：任务 prompt 里常含「接口/返回/API」等语义词，不能据此误判。
  if (change.status && looksLikeTaskEvent(note)) return 'episodic';

  // 2) 关键词分层（仅作用于非任务事件文本）
  for (const { category, hints } of CATEGORY_HINTS) {
    if (hints.some((h) => lower.includes(h))) return category;
  }

  // 3) 纯节点/边语义操作 → 语义知识（add_node/add_edge 属于稳定图结构）
  if (change.op === 'add_node' || change.op === 'add_edge') return 'semantic';

  // 4) 兜底：带状态的事件 → 情景；否则语义
  return change.status ? 'episodic' : 'semantic';
}

/** 从 change 抽取结构化事实（subject/predicate/object）。 */
export function extractFact(change: MemoryChange): SemanticFact {
  const category = classifyChange(change);
  const note = change.note ?? '';

  // 任务事件 note：`agent@device 「prompt」 → result`
  const taskMatch = /^([^@\s]+)@(\S+)\s+「([^」]*)」(?:\s*→\s*(.*))?$/.exec(note);
  if (taskMatch) {
    return {
      category,
      subject: `${taskMatch[1]}@${taskMatch[2]}`,
      predicate: change.status ?? change.op,
      object: taskMatch[4]?.slice(0, 80) || taskMatch[3]!.slice(0, 80),
      confidence: 1,
      sourceId: change.id,
    };
  }

  // 通用：按 note 拆出主谓（简单启发：第一段作 subject，其余作 object）
  const firstWord = note.split(/[\s，。：:]/, 1)[0] || note;
  return {
    category,
    subject: change.target.slice(0, 60),
    predicate: change.op,
    object: note.slice(0, 120),
    confidence: category === 'semantic' || category === 'episodic' ? 0.7 : 1,
    sourceId: change.id,
  };
}

/** 对一批 change 做语义分层统计 + 覆盖率 + 结构化事实样本。 */
export function semanticDistribution(changes: MemoryChange[]): {
  byCategory: Record<SemanticCategory, number>;
  coverage: number;
  facts: SemanticFact[];
} {
  const byCategory: Record<SemanticCategory, number> = {
    profile: 0,
    semantic: 0,
    episodic: 0,
    variable: 0,
    summary: 0,
  };
  const facts: SemanticFact[] = [];
  for (const c of changes) {
    const cat = classifyChange(c);
    byCategory[cat] += 1;
    facts.push(extractFact(c));
  }
  const total = changes.length;
  return {
    byCategory,
    coverage: total > 0 ? 1 : 0, // 分类器永不为 null，覆盖率 100%
    facts,
  };
}
