import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { parseReason } from '@agentfleet/shared';
import { tieredPolicy } from '../src/services/tieredPolicy.js';
import { actionGuard } from '../src/services/actionGuard.js';
import {
  listPolicyNotices,
  markPolicyNotices,
} from '../src/db/repo/confirmations.js';
import { effectQueue } from '../src/services/effects/effectQueue.js';
import { healthBoard } from '../src/services/healthBoard.js';

/**
 * DSH policyVersion / Mandate / revalidate（docs/29）：
 *   - 受理时锁住策略版本（内容派生哈希，相同策略必得相同版本）
 *   - 策略变更只通知在途单，不撤销既有授权
 *   - 命令执行前复检当前策略，deny 则拒绝
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-policy-'));
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
  tieredPolicy.reset();
  config.actionGuardEnabled = true;
  // 复刻 index.ts 的 adapter 注入（core 保持无 I/O）
  tieredPolicy.onChange((change) => markPolicyNotices(change.noticeJson));
});

describe('策略版本 Mandate', () => {
  it('version() 内容派生且稳定；档位真正变化时才变', () => {
    const v0 = tieredPolicy.version();
    expect(tieredPolicy.version()).toBe(v0);
    expect(v0).toHaveLength(32);
    tieredPolicy.setTier('deploy', 'ask'); // 同值
    expect(tieredPolicy.version()).toBe(v0);
    tieredPolicy.setTier('deploy', 'allow');
    expect(tieredPolicy.version()).not.toBe(v0);
    tieredPolicy.setTier('deploy', 'ask');
    expect(tieredPolicy.version()).toBe(v0);
  });

  it('request 锁住受理时版本；策略变更只写 notice，不撤销 Mandate', () => {
    const v0 = tieredPolicy.version();
    const pending = actionGuard.request('deploy', 'batch-mandate', '部署 3 台');
    expect(pending.status).toBe('pending_confirmation');
    expect(pending.policyVersion).toBe(v0);
    expect(pending.policyNotice).toBeUndefined();

    tieredPolicy.setTier('uninstall', 'deny'); // 触发变更通知
    const after = actionGuard.get(pending.id);
    expect(after?.policyVersion).toBe(v0);
    expect(after?.status).toBe('pending_confirmation');
    expect(after?.policyNotice).toBeTruthy();
    expect(parseReason(after?.policyNotice).code).toBe('policyChanged');
    expect(listPolicyNotices().some((n) => n.id === pending.id)).toBe(true);
  });

  it('已确认的单不受后续策略变更影响（不回溯撤销）', () => {
    const c = actionGuard.request('deploy', 'batch-done', '已完成确认');
    actionGuard.confirm(c.id, 'alice');
    tieredPolicy.setTier('asset_deliver', 'deny');
    const after = actionGuard.get(c.id);
    expect(after?.status).toBe('executed');
    expect(after?.policyNotice).toBeUndefined();
  });

  it('revalidate：受理后策略改为 deny → confirm 拒绝并写结构化原因', () => {
    const c = actionGuard.request('uninstall', 'dev-revalidate', '卸载');
    expect(c.status).toBe('pending_confirmation');
    tieredPolicy.setTier('uninstall', 'deny');
    const rejected = actionGuard.confirm(c.id, 'alice');
    expect(rejected?.status).toBe('rejected');
    expect(parseReason(rejected?.reason).code).toBe('revalidateDenied');
    expect(actionGuard.isConfirmed('uninstall', 'dev-revalidate')).toBe(false);
  });

  it('deny 档自动拒绝也留下可判定的原因码（诚实报告）', () => {
    tieredPolicy.setTier('loop_start', 'deny');
    const c = actionGuard.request('loop_start', 'loop-denied', '启动 loop');
    expect(c.status).toBe('rejected');
    expect(parseReason(c.reason).code).toBe('authorizationDenied');
  });

  it('allow 自动放行也锁版本，并登记到持久副作用队列', () => {
    tieredPolicy.setTier('deploy', 'allow');
    const v0 = tieredPolicy.version();
    const c = actionGuard.request('deploy', 'batch-allow-auto', '自动放行');
    expect(['confirmed', 'executed']).toContain(c.status);
    expect(c.policyVersion).toBe(v0);
    expect(effectQueue.list({ kind: 'deploy' }).some((r) => r.payload.refId === 'batch-allow-auto')).toBe(true);
  });
});
