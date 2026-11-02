import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { actionGuard } from '../src/services/actionGuard.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-guard-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  config.actionGuardEnabled = true;
});

describe('actionGuard（人工确认开关）', () => {
  it('request 后未确认 → isConfirmed=false，状态 pending_confirmation', () => {
    const c = actionGuard.request('deploy', 'batch-1', '部署 1 台目标机');
    expect(c.status).toBe('pending_confirmation');
    expect(actionGuard.isConfirmed('deploy', 'batch-1')).toBe(false);
  });

  it('confirm 后 isConfirmed=true，状态流转 executed', () => {
    const c = actionGuard.request('asset_deliver', 'delivery-1', '下发资产');
    const confirmed = actionGuard.confirm(c.id, 'alice');
    expect(confirmed?.status).toBe('executed');
    expect(actionGuard.isConfirmed('asset_deliver', 'delivery-1')).toBe(true);
  });

  it('reject 后 isConfirmed=false', () => {
    const c = actionGuard.request('loop_start', 'loop-1', '启动 loop');
    actionGuard.reject(c.id, 'alice');
    expect(actionGuard.isConfirmed('loop_start', 'loop-1')).toBe(false);
  });

  it('confirmByRef 按 kind+refId 确认', () => {
    actionGuard.request('deploy', 'batch-ref', '按 ref 确认');
    const confirmed = actionGuard.confirmByRef('deploy', 'batch-ref', 'bob');
    expect(confirmed?.status).toBe('executed');
    expect(actionGuard.isConfirmed('deploy', 'batch-ref')).toBe(true);
  });

  it('confirm 触发已注册执行器', () =>
    new Promise<void>((resolve) => {
      let called = '';
      actionGuard.registerExecutor('deploy', (refId) => {
        called = refId;
      });
      const c = actionGuard.request('deploy', 'batch-exec', '执行器触发');
      actionGuard.confirm(c.id, 'alice');
      setTimeout(() => {
        expect(called).toBe('batch-exec');
        resolve();
      }, 10);
    }));

  it('开关关闭时 request 自动放行', () => {
    config.actionGuardEnabled = false;
    const c = actionGuard.request('deploy', 'batch-auto', '自动放行');
    expect(['confirmed', 'executed']).toContain(c.status);
    expect(actionGuard.isConfirmed('deploy', 'batch-auto')).toBe(true);
  });
});
