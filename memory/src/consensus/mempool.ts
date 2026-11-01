/**
 * Mempool：待打包 change 缓冲，按 change.id 幂等去重。
 */
import type { MemoryChange } from '../types/block';

/** 待打包 change 缓冲。 */
export class Mempool {
  private readonly changes: MemoryChange[] = [];
  private readonly seen = new Set<string>();

  /**
   * 加入一条 change；按 change.id 幂等去重。
   * @returns true 表示新加入，false 表示重复（已存在，忽略）。
   */
  add(change: MemoryChange): boolean {
    if (this.seen.has(change.id)) return false;
    this.seen.add(change.id);
    this.changes.push(change);
    return true;
  }

  /** 取出前 n 条并移除（先进先出）。 */
  drain(n: number): MemoryChange[] {
    const count = Math.max(0, Math.floor(n));
    const out = this.changes.splice(0, count);
    for (const change of out) this.seen.delete(change.id);
    return out;
  }

  /** 当前待打包条数。 */
  size(): number {
    return this.changes.length;
  }

  /** 是否已包含某 id。 */
  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** 只读快照（不修改内部状态）。 */
  all(): MemoryChange[] {
    return [...this.changes];
  }
}
