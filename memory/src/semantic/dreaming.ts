/**
 * Dreaming 自演化（P1-2，借鉴 openJiuwen agent-memory 的三阶段 Dreaming）。
 *
 * 三阶段：筛候选（select）→ 抽取（extract）→ 冲突消解写回语义索引（merge）。
 * 只写「语义索引层」，绝不写账本、不破坏 append-only 防篡改。
 *
 * 约束：
 *   - 幂等：同批 change 重复 dream 不产生重复事实（按 category+subject+predicate 去重）
 *   - busy-retreat：外部置 busy 时 dream 立即返回（不抢调度/出块资源）
 *   - 空闲触发：由调用方（memoryLedger）在空闲时驱动，不阻塞出块热路径
 */
import type { MemoryChange } from '../types/block';
import { extractFact, type SemanticCategory, type SemanticFact } from './extractor';

/** Dreaming 一次执行结果 */
export interface DreamResult {
  /** 本次筛选出的候选 change 数 */
  selected: number;
  /** 合并后语义索引事实总数 */
  merged: number;
  /** 本次新增事实数 */
  newFacts: number;
  /** 本次冲突消解（覆盖旧事实）数 */
  updatedFacts: number;
  /** 是否因 busy 提前撤退 */
  retreated: boolean;
}

/** 冲突消解 key：category + subject + predicate（同键视为同一事实） */
function factKey(f: SemanticFact): string {
  return `${f.category}|${f.subject}|${f.predicate}`;
}

export class DreamEngine {
  private facts = new Map<string, SemanticFact>();
  /** busy 标志：外部（出块 flush 等）置 true 时 dream 立即撤退 */
  private busy = false;

  setBusy(v: boolean): void {
    this.busy = v;
  }

  isBusy(): boolean {
    return this.busy;
  }

  /** 筛候选：挑出「值得沉淀」的 change（有实质 note、排除诊断记录） */
  private selectCandidates(changes: MemoryChange[]): MemoryChange[] {
    return changes.filter((c) => c.note && c.note.trim().length > 0 && !c.target.startsWith('diag:'));
  }

  /** 执行一次 Dreaming：筛候选 → 抽取 → 冲突消解写回语义索引（不写账本）。幂等。 */
  dream(changes: MemoryChange[]): DreamResult {
    if (this.busy) {
      return { selected: 0, merged: this.facts.size, newFacts: 0, updatedFacts: 0, retreated: true };
    }
    const candidates = this.selectCandidates(changes);
    let newFacts = 0;
    let updatedFacts = 0;
    for (const c of candidates) {
      const f = extractFact(c);
      const key = factKey(f);
      const prev = this.facts.get(key);
      if (!prev) {
        this.facts.set(key, f);
        newFacts += 1;
      } else if (prev.object !== f.object && f.confidence >= prev.confidence) {
        // 冲突消解：同一主谓出现新宾语，且置信度不降 → 覆盖（新事实胜旧）
        this.facts.set(key, f);
        updatedFacts += 1;
      }
      // 完全相同 → 跳过（幂等，不重复计数）
    }
    return {
      selected: candidates.length,
      merged: this.facts.size,
      newFacts,
      updatedFacts,
      retreated: false,
    };
  }

  /** 全部沉淀事实 */
  all(): SemanticFact[] {
    return Array.from(this.facts.values());
  }

  /** 按类别取事实 */
  byCategory(category: SemanticCategory): SemanticFact[] {
    return this.all().filter((f) => f.category === category);
  }

  /** 索引规模 */
  size(): number {
    return this.facts.size;
  }
}
