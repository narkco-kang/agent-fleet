import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as svc from '../src/services/routing/platformModelService.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-platformmodel-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  svc.unbind('dev-a');
});

describe('平台模型绑定 + 故障切换', () => {
  it('bind / resolve / list', () => {
    svc.bind('dev-a', 'codex', 'kimi/k3', ['glm/strong', 'qwen/max']);
    const b = svc.resolve('dev-a', 'codex');
    expect(b?.model).toBe('kimi/k3');
    expect(b?.fallbacks).toEqual(['glm/strong', 'qwen/max']);
    expect(b?.activeModel).toBe('kimi/k3');
    expect(b?.state).toBe('ok');
    expect(svc.list()).toHaveLength(1);
  });

  it('markModelFailed：主模型失败自动切换兜底', () => {
    svc.bind('dev-a', 'codex', 'kimi/k3', ['glm/strong', 'qwen/max']);
    const r = svc.markModelFailed('dev-a', 'codex', 'kimi/k3');
    expect(r.degraded).toBe(false);
    expect(r.switchedTo).toBe('glm/strong');
    expect(svc.resolve('dev-a', 'codex')?.activeModel).toBe('glm/strong');
  });

  it('markModelFailed：全部失败 → degraded（降级本地）', () => {
    svc.bind('dev-a', 'codex', 'kimi/k3', ['glm/strong']);
    svc.markModelFailed('dev-a', 'codex', 'kimi/k3');
    const r = svc.markModelFailed('dev-a', 'codex', 'glm/strong');
    expect(r.degraded).toBe(true);
    expect(svc.resolve('dev-a', 'codex')).toBeUndefined();
    // 但绑定记录仍在
    expect(svc.list().find((b) => b.agentType === 'codex')?.state).toBe('degraded');
  });

  it('switchModel 手动切换 + reset 恢复健康', () => {
    svc.bind('dev-a', 'codex', 'kimi/k3', ['glm/strong', 'qwen/max']);
    svc.markModelFailed('dev-a', 'codex', 'kimi/k3');
    const switched = svc.switchModel('dev-a', 'codex', 'qwen/max');
    expect(switched?.activeModel).toBe('qwen/max');
    expect(switched?.state).toBe('ok');
    expect(svc.resolve('dev-a', 'codex')?.activeModel).toBe('qwen/max');
    // 未知模型抛错
    expect(() => svc.switchModel('dev-a', 'codex', 'nope/model')).toThrow('unknown model');
    // 降级后 reset 恢复
    svc.markModelFailed('dev-a', 'codex', 'qwen/max');
    svc.markModelFailed('dev-a', 'codex', 'glm/strong');
    const reset = svc.reset('dev-a', 'codex');
    expect(reset?.state).toBe('ok');
  });

  it('bindPlatformModels 批量绑定', () => {
    const n = svc.bindPlatformModels('dev-a', [
      { agentType: 'codex', model: 'kimi/k3', fallbacks: ['glm/strong'] },
      { agentType: 'claude', model: 'claude/opus' },
    ]);
    expect(n).toBe(2);
    expect(svc.list()).toHaveLength(2);
  });
});
