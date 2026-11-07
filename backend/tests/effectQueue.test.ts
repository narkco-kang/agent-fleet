import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase, getDb } from '../src/db/database.js';
import { config } from '../src/config.js';
import { parseReason } from '@agentfleet/shared';
import { effectQueue, later } from '../src/services/effects/effectQueue.js';
import { healthBoard } from '../src/services/healthBoard.js';

/**
 * DSH 持久副作用队列（docs/29）：
 *   - 事务内登记 + 提交后执行（回滚则副作用一并消失）
 *   - PRIMARY KEY(kind,key) 幂等 + coalescing 不改 seq
 *   - generation 守卫：运行中又被合并的旧尝试不能删掉新 payload
 *   - 失败指数退避；LaterError 不计失败；耗尽标 dead；崩溃后 pending 续跑
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-effects-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  effectQueue.reset();
  healthBoard.reset();
});

describe('持久副作用队列', () => {
  it('事务内登记：回滚则副作用行一并消失（状态与副作用同生共死）', () => {
    expect(() =>
      effectQueue.transaction(() => {
        effectQueue.enqueue('tx', 'k1', { v: 1 });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(effectQueue.list({ kind: 'tx' })).toHaveLength(0);
  });

  it('相同 (kind,key) 幂等合并：payload 换新、generation+1、seq 不变', () => {
    const first = effectQueue.enqueue('noop', 'k1', { v: 1 });
    const second = effectQueue.enqueue('noop', 'k1', { v: 2 });
    const rows = effectQueue.list({ kind: 'noop' });
    expect(rows).toHaveLength(1);
    expect(second.seq).toBe(first.seq);
    expect(second.generation).toBe(first.generation + 1);
    expect(rows[0]?.payload.v).toBe(2);
  });

  it('成功执行后删除行，并让 HealthBoard 保持 ready', async () => {
    let seen = '';
    effectQueue.register('ok', async (payload) => {
      seen = String(payload.v);
    });
    effectQueue.enqueue('ok', 'k1', { v: 7 });
    await effectQueue.drain();
    expect(seen).toBe('7');
    expect(effectQueue.list({ kind: 'ok' })).toHaveLength(0);
    expect(healthBoard.get('effect:ok')?.state).toBe('ready');
  });

  it('失败按结构化原因留痕 + 退避重试，健康条目降为 degraded', async () => {
    effectQueue.register(
      'fail',
      () => {
        throw new Error('ssh down');
      },
      { retry: [60_000, 60_000], maxAttempts: 3 },
    );
    effectQueue.enqueue('fail', 'k1', {});
    await effectQueue.drain();
    const row = effectQueue.list({ kind: 'fail' })[0];
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.dueAt).toBeGreaterThan(Date.now());
    expect(parseReason(row?.lastError).code).toBe('effectFailed');
    expect(healthBoard.get('effect:fail')?.state).toBe('degraded');
  });

  it('LaterError 只延期、不计失败、不触发健康告警', async () => {
    effectQueue.register(
      'later',
      () => {
        throw later('device busy');
      },
      { retry: [60_000, 60_000] },
    );
    effectQueue.enqueue('later', 'k1', {});
    await effectQueue.drain();
    const row = effectQueue.list({ kind: 'later' })[0];
    expect(row?.attempts).toBe(0);
    expect(parseReason(row?.lastError).code).toBe('effectDeferred');
    expect(healthBoard.get('effect:later')?.state).toBe('ready');
  });

  it('重试耗尽标 dead（待人处理），retry 可复活并重新执行', async () => {
    let shouldFail = true;
    effectQueue.register(
      'dead',
      () => {
        if (shouldFail) throw new Error('always down');
      },
      { retry: [60_000, 60_000], maxAttempts: 1 },
    );
    effectQueue.enqueue('dead', 'k1', {});
    await effectQueue.drain();
    const dead = effectQueue.list({ kind: 'dead', status: 'dead' })[0];
    expect(dead?.status).toBe('dead');
    expect(parseReason(dead?.lastError).code).toBe('effectDead');

    shouldFail = false;
    const revived = effectQueue.retry('dead', 'k1');
    expect(revived?.status).toBe('pending');
    expect(revived?.attempts).toBe(0);
    await effectQueue.drain();
    expect(effectQueue.list({ kind: 'dead' })).toHaveLength(0);
  });

  it('generation 守卫：运行中又被合并，旧尝试不能删掉新 payload', async () => {
    const db = getDb();
    // 模拟一次已派发（gen=0）的行，绕开 kick 以便精确控制
    db.prepare(
      `INSERT INTO effects (kind, effect_key, payload, seq, generation, attempts, last_error, due_at, status, created_at, updated_at)
       VALUES ('gen', 'k1', ?, 1, 0, 0, '', ?, 'pending', ?, ?)`,
    ).run(JSON.stringify({ v: 1 }), 0, Date.now(), Date.now());

    let started!: () => void;
    let release!: () => void;
    const startedP = new Promise<void>((r) => { started = r; });
    const gate = new Promise<void>((r) => { release = r; });
    effectQueue.register('gen', async () => {
      started();
      await gate;
    });

    const draining = effectQueue.drain();
    await startedP;
    // 运行途中被 enqueue 合并：新 payload + generation=1
    db.prepare(`UPDATE effects SET payload = ?, generation = 1 WHERE kind = 'gen' AND effect_key = 'k1'`)
      .run(JSON.stringify({ v: 2 }));
    release();
    await draining;

    const rows = effectQueue.list({ kind: 'gen' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.generation).toBe(1);
    expect(rows[0]?.payload.v).toBe(2);
  });

  it('崩溃恢复：pending 行在 handler 就绪 + start() 后自动续跑', async () => {
    // 无 handler 时入队 → 行留在库里（模拟进程崩溃时已登记但未执行）
    effectQueue.enqueue('recover', 'k1', { v: 1 });
    expect(effectQueue.stats().pending).toBe(1);

    let seen = '';
    effectQueue.register('recover', (payload) => {
      seen = String(payload.v);
    });
    effectQueue.start(1000);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toBe('1');
    expect(effectQueue.list({ kind: 'recover' })).toHaveLength(0);
    effectQueue.stop();
  });
});
