import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { tieredPolicy } from '../src/services/tieredPolicy.js';
import { actionGuard } from '../src/services/actionGuard.js';

/**
 * P2-3 权限目录（tiered_policy）：allow / ask / deny 三档接 actionGuard。
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-tiered-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  config.actionGuardEnabled = true;
  tieredPolicy.reset();
});

describe('权限目录三档（P2-3）', () => {
  it('默认全 ask', () => {
    const all = tieredPolicy.all();
    expect(all.deploy).toBe('ask');
    expect(all.uninstall).toBe('ask');
    expect(all.asset_deliver).toBe('ask');
    expect(all.loop_start).toBe('ask');
  });

  it('setTier 调整单动作档位，reset 恢复默认', () => {
    tieredPolicy.setTier('deploy', 'allow');
    expect(tieredPolicy.getTier('deploy')).toBe('allow');
    expect(tieredPolicy.getTier('uninstall')).toBe('ask'); // 其它不受影响
    tieredPolicy.reset();
    expect(tieredPolicy.getTier('deploy')).toBe('ask');
  });

  it('deny 档：request 自动拒绝，不执行', () => {
    tieredPolicy.setTier('uninstall', 'deny');
    const c = actionGuard.request('uninstall', 'dev-x', '卸载');
    expect(c.status).toBe('rejected');
    expect(actionGuard.isConfirmed('uninstall', 'dev-x')).toBe(false);
  });

  it('allow 档：request 自动放行（留审计）', () => {
    tieredPolicy.setTier('asset_deliver', 'allow');
    const c = actionGuard.request('asset_deliver', 'delivery-auto', '自动下发');
    expect(['confirmed', 'executed']).toContain(c.status);
    expect(actionGuard.isConfirmed('asset_deliver', 'delivery-auto')).toBe(true);
  });

  it('ask 档：request 仍需人工确认', () => {
    const c = actionGuard.request('deploy', 'batch-ask', '需确认');
    expect(c.status).toBe('pending_confirmation');
  });
});
