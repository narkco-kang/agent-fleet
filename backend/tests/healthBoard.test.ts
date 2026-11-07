import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { FAILURES_BEFORE_ERROR, healthBoard } from '../src/services/healthBoard.js';
import { reasonOf } from '@agentfleet/shared';

/**
 * DSH HealthBoard（docs/29）：
 *   1. 一个条目一个写入者，claim 拒绝二次声明
 *   2. 连续失败 3 次才升 error（一次抖动不惊动人）
 *   3. 成功一次立即清除
 *   4. release 后迟到上报变 no-op
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-health-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => healthBoard.reset());

describe('HealthBoard 单一写入者', () => {
  it('不同 owner 二次 claim 抛错；同一 owner 幂等（便于重启/测试）', () => {
    const a = healthBoard.claim('relay', 'relayClient');
    expect(() => healthBoard.claim('relay', 'otherService')).toThrow(/already claimed/);
    expect(() => healthBoard.claim('relay', 'relayClient')).not.toThrow();
    expect(healthBoard.get('relay')?.owner).toBe('relayClient');
    a.release();
  });

  it('claim 会创建 ready 条目；跨进程（DB owner）也会拦截', () => {
    const h = healthBoard.claim('model-probe', 'modelProbeHealth');
    expect(healthBoard.get('model-probe')?.state).toBe('ready');
    h.release();
    // 模拟另一个进程持有同一条目
    healthBoard.reset();
    healthBoard.claim('model-probe', 'anotherOwner');
    expect(() => healthBoard.claim('model-probe', 'modelProbeHealth')).toThrow(/already claimed/);
  });

  it(`连续 ${FAILURES_BEFORE_ERROR} 次失败才升 error，成功一次立即清除`, () => {
    const h = healthBoard.claim('effect:deploy', 'effects');
    h.failure(reasonOf('effectFailed', { attempts: 1, detail: 'ssh' }));
    expect(healthBoard.get('effect:deploy')?.state).toBe('degraded');
    h.failure(reasonOf('effectFailed', { attempts: 2, detail: 'ssh' }));
    expect(healthBoard.get('effect:deploy')?.state).toBe('degraded');
    h.failure(reasonOf('effectFailed', { attempts: 3, detail: 'ssh' }));
    expect(healthBoard.get('effect:deploy')?.state).toBe('error');
    expect(healthBoard.get('effect:deploy')?.failures).toBe(3);
    expect(healthBoard.get('effect:deploy')?.lastError).toContain('第 3 次');

    h.ok();
    expect(healthBoard.get('effect:deploy')).toMatchObject({ state: 'ready', failures: 0, lastError: '' });
  });

  it('warn 用于有自动降级兜底的可选组件：永不升 error', () => {
    const h = healthBoard.claim('modelgateway', 'modelProbeHealth');
    for (let i = 0; i < 10; i++) h.warn(reasonOf('probeFailed', { detail: 'gateway down' }));
    const entry = healthBoard.get('modelgateway');
    expect(entry?.state).toBe('degraded');
    expect(entry?.failures).toBe(FAILURES_BEFORE_ERROR - 1);
    expect(healthBoard.summary().errors).toBe(0);
    h.ok();
    expect(healthBoard.get('modelgateway')?.state).toBe('ready');
  });

  it('release 之后的 ok/failure 是 no-op，不污染状态', () => {
    const h = healthBoard.claim('gateway', 'gatewayManager');
    h.release();
    h.failure('迟到的失败');
    h.ok();
    expect(healthBoard.get('gateway')).toMatchObject({ state: 'ready', failures: 0, lastError: '' });
  });

  it('summary 只汇总需要人看的 error/degraded', () => {
    const a = healthBoard.claim('a', 'svc-a');
    const b = healthBoard.claim('b', 'svc-b');
    healthBoard.claim('c', 'svc-c');
    a.failure('x');
    a.failure('x');
    a.failure('x');
    for (let i = 0; i < 3; i++) b.failure('y');
    const s = healthBoard.summary();
    expect(s.total).toBe(3);
    expect(s.ready).toBe(1);
    expect(s.errors).toBe(2);
    expect(s.errorNames.sort()).toEqual(['a', 'b']);
  });
});
