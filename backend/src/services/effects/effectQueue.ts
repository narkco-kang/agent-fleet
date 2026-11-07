import { getDb } from '../../db/database.js';
import { healthBoard, type HealthHandle } from '../healthBoard.js';
import { reasonJson, reasonOf, reasonText, type Reason } from '@agentfleet/shared';

/**
 * 持久副作用队列（借鉴 dsh-superagent `src/app/effects.ts`，docs/007:164-181）。
 *
 * DSH 的核心可靠性原则：**Engine 是唯一写入者，领域核心纯同步、每命令一个事务；
 * 端口在事务内只登记外部工作，adapter 在提交后执行**。这样领域一致性与副作用彻底分离。
 *
 * 本实现把这个原则落到 AgentFleet：
 *   - `transaction(fn)` 包住「状态变更 + enqueue」，回滚则副作用一并消失
 *   - `enqueue` 只写行，`kick()` 用 microtask 在提交后才 dispatch
 *   - 每行 `PRIMARY KEY(kind, effect_key)` → 幂等；重复入队 coalescing：
 *     替换 payload、`generation+1`、`attempts=0`、`due_at=now`，**seq 不变**（保住队列位置）
 *   - 结算一律带 `WHERE seq=? AND generation=?`：运行中若被合并，旧尝试不能删/改新 payload
 *   - 失败指数退避；`LaterError` 只延期、不计失败；按 kind 并发限流 + `ordered` 严格保序
 *   - 进程崩溃：running 只在内存，行仍是 pending → 重启后自动续跑，不丢状态
 *   - 成功删除行（同 key 之后可再次入队）；重试耗尽标 `dead` 等人工处理
 *   - 每个 kind 一个健康条目（连续 3 次失败才升 error，成功一次即清除）
 */

/** 抛这个错误表示「现在做不了，稍后再试」，不计入失败次数 */
export class LaterError extends Error {
  constructor(message = 'later') {
    super(message);
    this.name = 'LaterError';
  }
}

export function later(detail: string): LaterError {
  return new LaterError(detail);
}

export interface EffectOptions {
  /** 同 kind 最大并发，默认 4 */
  limit?: number;
  /** [基础退避 ms, 最大退避 ms]，默认 [2000, 60000] */
  retry?: [number, number];
  /** 严格保序：一次只跑该 kind 最老的一行，失败则阻断后续 */
  ordered?: boolean;
  /** 失败只在行上留痕，不升级为健康告警（类似 DSH delivery 显示在 Ticket 上） */
  quiet?: boolean;
  /** 重试上限，默认 6；耗尽标 dead */
  maxAttempts?: number;
}

export interface EffectContext {
  kind: string;
  effectKey: string;
  attempt: number;
  generation: number;
}

export type EffectHandler = (
  payload: Record<string, unknown>,
  ctx: EffectContext,
) => void | Promise<void>;

export interface EffectRow {
  kind: string;
  effectKey: string;
  payload: Record<string, unknown>;
  seq: number;
  generation: number;
  attempts: number;
  lastError: string;
  dueAt: number;
  status: 'pending' | 'dead';
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
}

interface EffectDbRow {
  kind: string;
  effect_key: string;
  payload: string;
  seq: number;
  generation: number;
  attempts: number;
  last_error: string;
  due_at: number;
  status: string;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

interface HandlerSpec {
  run: EffectHandler;
  options: Required<EffectOptions>;
  health: HealthHandle;
}

function toRow(row: EffectDbRow): EffectRow {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    /* 容错：坏 payload 仍可展示 */
  }
  return {
    kind: row.kind,
    effectKey: row.effect_key,
    payload,
    seq: row.seq,
    generation: row.generation,
    attempts: row.attempts,
    lastError: row.last_error,
    dueAt: row.due_at,
    status: row.status === 'dead' ? 'dead' : 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

class EffectQueue {
  private readonly handlers = new Map<string, HandlerSpec>();
  /** 运行中的 `kind:effectKey`，仅内存 → 崩溃后行仍 pending（恢复关键） */
  private readonly running = new Map<string, Set<string>>();
  private timer: NodeJS.Timeout | null = null;
  private kickScheduled = false;
  private draining = false;
  private drainAgain = false;
  private stopped = false;

  /**
   * 在**一个事务**里执行 fn：状态变更与副作用登记同时成功或同时回滚。
   * 提交后的 dispatch 由 enqueue 触发的 microtask 完成。
   */
  transaction<T>(fn: () => T): T {
    return getDb().transaction(fn)();
  }

  /** 注册某 kind 的执行器；同时 claim 其健康条目（单一写入者） */
  register(kind: string, run: EffectHandler, options: EffectOptions = {}): void {
    const spec: HandlerSpec = {
      run,
      options: {
        limit: options.limit ?? 4,
        retry: options.retry ?? [2000, 60000],
        ordered: options.ordered ?? false,
        quiet: options.quiet ?? false,
        maxAttempts: options.maxAttempts ?? 6,
      },
      health: healthBoard.claim(`effect:${kind}`, 'effects'),
    };
    this.handlers.set(kind, spec);
  }

  hasHandler(kind: string): boolean {
    return this.handlers.has(kind);
  }

  /**
   * 幂等入队。相同 (kind, effectKey) 只保留一行：
   * 重复入队替换 payload、generation+1、重置失败计数并立即到期，seq 保持原位。
   */
  enqueue(kind: string, effectKey: string, payload: Record<string, unknown> = {}): EffectRow {
    const db = getDb();
    const now = Date.now();
    const nextSeq = (
      db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM effects`).get() as { n: number }
    ).n;
    db.prepare(
      `INSERT INTO effects
        (kind, effect_key, payload, seq, generation, attempts, last_error, due_at, status, created_at, updated_at)
       VALUES (@kind, @key, @payload, @seq, 0, 0, '', @now, 'pending', @now, @now)
       ON CONFLICT(kind, effect_key) DO UPDATE SET
         payload = excluded.payload,
         generation = effects.generation + 1,
         attempts = 0,
         last_error = '',
         due_at = excluded.due_at,
         status = 'pending',
         updated_at = excluded.updated_at,
         finished_at = NULL`,
    ).run({
      kind,
      key: effectKey,
      payload: JSON.stringify(payload),
      seq: nextSeq,
      now,
    });
    const row = db
      .prepare(`SELECT * FROM effects WHERE kind = ? AND effect_key = ?`)
      .get(kind, effectKey) as EffectDbRow;
    this.kick();
    return toRow(row);
  }

  /** 提交后调度一次 drain（microtask 保证不在事务内执行副作用） */
  kick(): void {
    if (this.stopped || this.kickScheduled) return;
    this.kickScheduled = true;
    queueMicrotask(() => {
      this.kickScheduled = false;
      void this.drain().catch((err) => {
        console.error('[effects] drain 失败:', err);
      });
    });
  }

  /** 启动周期扫描（捡起退避到期的行）；pending 行在 start() 前也会被 kick 执行 */
  start(intervalMs = 1000): void {
    this.stopped = false;
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), Math.max(200, intervalMs));
    this.timer.unref();
    this.kick();
  }

  /** 优雅退出：停扫描，但**保留 pending 行**（下次启动续跑） */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 手动触发一次 drain（运维/测试） */
  async drain(): Promise<void> {
    if (this.stopped) return;
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        await this.drainOnce();
      } while (this.drainAgain);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    const db = getDb();
    const now = Date.now();
    const jobs: Array<{ row: EffectRow; spec: HandlerSpec }> = [];

    for (const [kind, spec] of this.handlers) {
      const active = this.running.get(kind)?.size ?? 0;
      const limit = spec.options.ordered ? 1 : spec.options.limit;
      const room = Math.max(0, limit - active);
      if (room === 0) continue;

      let rows: EffectDbRow[];
      if (spec.options.ordered) {
        // 严格保序：只看最老一行；它没到期或失败重试中，后续全部等待
        rows = db
          .prepare(
            `SELECT * FROM effects WHERE kind = ? AND status = 'pending' ORDER BY seq ASC LIMIT 1`,
          )
          .all(kind) as EffectDbRow[];
        rows = rows.filter((r) => r.due_at <= now);
      } else {
        rows = db
          .prepare(
            `SELECT * FROM effects
              WHERE kind = ? AND status = 'pending' AND due_at <= ?
              ORDER BY seq ASC LIMIT ?`,
          )
          .all(kind, now, room) as EffectDbRow[];
      }
      for (const row of rows) jobs.push({ row: toRow(row), spec });
    }

    if (jobs.length === 0) return;
    await Promise.all(jobs.map((job) => this.runOne(job.row, job.spec)));
  }

  private async runOne(row: EffectRow, spec: HandlerSpec): Promise<void> {
    const marker = `${row.kind}:${row.effectKey}`;
    let active = this.running.get(row.kind);
    if (!active) {
      active = new Set<string>();
      this.running.set(row.kind, active);
    }
    active.add(marker);
    try {
      await spec.run(row.payload, {
        kind: row.kind,
        effectKey: row.effectKey,
        attempt: row.attempts + 1,
        generation: row.generation,
      });
      this.settleSuccess(row, spec);
    } catch (err) {
      this.settleFailure(row, spec, err);
    } finally {
      active.delete(marker);
    }
  }

  /** 成功：带 generation 守卫删除（合并后旧尝试删不掉新行） */
  private settleSuccess(row: EffectRow, spec: HandlerSpec): void {
    const changed = getDb()
      .prepare(
        `DELETE FROM effects
         WHERE kind = ? AND effect_key = ? AND seq = ? AND generation = ? AND status = 'pending'`,
      )
      .run(row.kind, row.effectKey, row.seq, row.generation).changes;
    if (changed > 0) spec.health.ok();
  }

  private settleFailure(row: EffectRow, spec: HandlerSpec, err: unknown): void {
    const db = getDb();
    const [base, max] = spec.options.retry;
    const deferred = err instanceof LaterError;
    const attempts = deferred ? row.attempts : row.attempts + 1;
    const delay = deferred
      ? base
      : Math.min(max, base * 2 ** Math.min(Math.max(0, attempts - 1), 16));
    const dead = !deferred && attempts >= spec.options.maxAttempts;
    const reason: Reason = dead
      ? reasonOf('effectDead', { kind: row.kind })
      : deferred
        ? reasonOf('effectDeferred', { detail: (err as Error).message })
        : reasonOf('effectFailed', { attempts, detail: (err as Error).message });

    // generation 守卫：合并后的新 payload 由新的一轮 drain 处理
    db.prepare(
      `UPDATE effects SET
         attempts = ?, last_error = ?, due_at = ?, status = ?, updated_at = ?,
         finished_at = ?
       WHERE kind = ? AND effect_key = ? AND seq = ? AND generation = ? AND status = 'pending'`,
    ).run(
      attempts,
      reasonJson(reason),
      Date.now() + delay,
      dead ? 'dead' : 'pending',
      Date.now(),
      dead ? Date.now() : null,
      row.kind,
      row.effectKey,
      row.seq,
      row.generation,
    );
    if (!spec.options.quiet && !deferred) spec.health.failure(reason);
    console.warn(`[effects] ${row.kind}/${row.effectKey}: ${reasonText(reason)}`);
  }

  /** 人工复活 dead 行 */
  retry(kind: string, effectKey: string): EffectRow | undefined {
    const db = getDb();
    const changed = db
      .prepare(
        `UPDATE effects SET status = 'pending', attempts = 0, last_error = '',
           due_at = ?, generation = generation + 1, updated_at = ?, finished_at = NULL
         WHERE kind = ? AND effect_key = ?`,
      )
      .run(Date.now(), Date.now(), kind, effectKey).changes;
    if (!changed) return undefined;
    this.kick();
    const row = db
      .prepare(`SELECT * FROM effects WHERE kind = ? AND effect_key = ?`)
      .get(kind, effectKey) as EffectDbRow;
    return toRow(row);
  }

  list(filter: { kind?: string; status?: 'pending' | 'dead' } = {}, limit = 200): EffectRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.kind) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = getDb()
      .prepare(`SELECT * FROM effects ${where} ORDER BY seq ASC LIMIT ?`)
      .all(...params, limit) as EffectDbRow[];
    return rows.map(toRow);
  }

  stats(): {
    pending: number;
    dead: number;
    running: number;
    kinds: number;
    byKind: Record<string, { pending: number; dead: number }>;
  } {
    const db = getDb();
    const rows = db
      .prepare(`SELECT kind, status, COUNT(*) AS n FROM effects GROUP BY kind, status`)
      .all() as Array<{ kind: string; status: string; n: number }>;
    const byKind: Record<string, { pending: number; dead: number }> = {};
    let pending = 0;
    let dead = 0;
    for (const r of rows) {
      byKind[r.kind] ??= { pending: 0, dead: 0 };
      if (r.status === 'dead') {
        byKind[r.kind].dead = r.n;
        dead += r.n;
      } else {
        byKind[r.kind].pending = r.n;
        pending += r.n;
      }
    }
    let running = 0;
    for (const set of this.running.values()) running += set.size;
    return { pending, dead, running, kinds: this.handlers.size, byKind };
  }

  /** 测试用：清 handler + 内存运行态（不动其他模块注册的 handler 语义） */
  reset(): void {
    for (const spec of this.handlers.values()) spec.health.release();
    this.handlers.clear();
    this.running.clear();
    this.stop();
    this.stopped = false;
    getDb().prepare(`DELETE FROM effects`).run();
  }
}

/** 全局单例 */
export const effectQueue = new EffectQueue();
