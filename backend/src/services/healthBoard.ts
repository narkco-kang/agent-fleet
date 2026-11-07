import { getDb } from '../db/database.js';
import { reasonText, type Reason } from '@agentfleet/shared';

/**
 * HealthBoard（借鉴 dsh-superagent `src/infra/health.ts` + `src/app/effects.ts`）。
 *
 * 三条铁律：
 * 1. **单一写入者**：每个健康条目只能被一个组件 claim，重复 claim 直接抛错；
 *    release 之后该 handle 的写入变 no-op，避免注销后的迟到上报污染状态。
 * 2. **连续失败 3 次才报错**：一次网络抖动只是 degraded，不惊动人
 *    （对应 AgentFleet「尽可能少占用人的注意力」）。
 * 3. **成功一次立即清除**：failures 归零、state 回 ready。
 *
 * 状态持久化在 SQLite，重启后不丢；claim 归属同时记库，防止两个进程抢同一条目。
 */

export const FAILURES_BEFORE_ERROR = 3;

export type HealthState = 'ready' | 'degraded' | 'error';

export interface HealthEntry {
  name: string;
  owner: string;
  state: HealthState;
  failures: number;
  lastError: string;
  updatedAt: number;
}

export interface HealthHandle {
  /** 一次成功即清除之前的失败计数 */
  ok(): void;
  /** 一次失败（连续 3 次升 error） */
  failure(reason: Reason | string): void;
  /**
   * 一次「有自动降级兜底的可选组件」异常：最高只到 degraded，永不升 error。
   * 例：modelgateway 未启动时路由自动降级本地，不需要惊动人。
   */
  warn(reason: Reason | string): void;
  /** 放弃写入权；之后 ok()/failure()/warn() 均为 no-op */
  release(): void;
}

interface HealthRow {
  name: string;
  owner: string;
  state: HealthState;
  failures: number;
  last_error: string;
  updated_at: number;
}

function nextFailures(db: ReturnType<typeof getDb>, name: string): number {
  const current = db
    .prepare(`SELECT failures FROM component_health WHERE name = ?`)
    .get(name) as { failures: number } | undefined;
  return (current?.failures ?? 0) + 1;
}

function toEntry(row: HealthRow): HealthEntry {
  return {
    name: row.name,
    owner: row.owner,
    state: row.state,
    failures: row.failures,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

class HealthBoard {
  /** 进程内 claim 表；与 DB owner 一起构成「二次声明」防线 */
  private readonly claimed = new Map<string, string>();

  /** 认领一个健康条目（同一 owner 重复认领是幂等的，便于重启/测试） */
  claim(name: string, owner: string): HealthHandle {
    const inMemory = this.claimed.get(name);
    if (inMemory && inMemory !== owner) {
      throw new Error(`health entry "${name}" already claimed by ${inMemory}`);
    }
    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM component_health WHERE name = ?`)
      .get(name) as HealthRow | undefined;
    if (row && row.owner !== owner) {
      throw new Error(`health entry "${name}" already claimed by ${row.owner}`);
    }
    this.claimed.set(name, owner);
    if (!row) {
      db.prepare(
        `INSERT OR IGNORE INTO component_health (name, owner, state, failures, last_error, updated_at)
         VALUES (?, ?, 'ready', 0, '', ?)`,
      ).run(name, owner, Date.now());
    }

    let released = false;
    const write = (state: HealthState, failures: number, lastError: string): void => {
      if (released) return;
      db.prepare(
        `UPDATE component_health SET state = ?, failures = ?, last_error = ?, updated_at = ?
         WHERE name = ? AND owner = ?`,
      ).run(state, failures, lastError, Date.now(), name, owner);
    };

    return {
      ok: () => write('ready', 0, ''),
      failure: (reason) => {
        const failures = nextFailures(db, name);
        const text = typeof reason === 'string' ? reason : reasonText(reason);
        write(failures >= FAILURES_BEFORE_ERROR ? 'error' : 'degraded', failures, text);
      },
      warn: (reason) => {
        // 上限 = FAILURES_BEFORE_ERROR - 1，永远不会升到 error
        const failures = Math.min(nextFailures(db, name), FAILURES_BEFORE_ERROR - 1);
        const text = typeof reason === 'string' ? reason : reasonText(reason);
        write('degraded', failures, text);
      },
      release: () => {
        released = true;
        this.claimed.delete(name);
      },
    };
  }

  get(name: string): HealthEntry | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM component_health WHERE name = ?`)
      .get(name) as HealthRow | undefined;
    return row ? toEntry(row) : undefined;
  }

  list(): HealthEntry[] {
    const rows = getDb()
      .prepare(`SELECT * FROM component_health ORDER BY name ASC`)
      .all() as HealthRow[];
    return rows.map(toEntry);
  }

  /** 供「待处理」摘要条使用：只暴露需要人看的东西 */
  summary(): { total: number; ready: number; degraded: number; errors: number; errorNames: string[] } {
    const entries = this.list();
    const errors = entries.filter((e) => e.state === 'error');
    return {
      total: entries.length,
      ready: entries.filter((e) => e.state === 'ready').length,
      degraded: entries.filter((e) => e.state === 'degraded').length,
      errors: errors.length,
      errorNames: errors.map((e) => e.name),
    };
  }

  /** 测试用：清空 claim 与持久化状态 */
  reset(): void {
    this.claimed.clear();
    getDb().prepare(`DELETE FROM component_health`).run();
  }
}

/** 全局单例 */
export const healthBoard = new HealthBoard();
