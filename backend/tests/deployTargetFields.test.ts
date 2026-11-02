import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { parseTargetsFromObjects } from '../src/services/deploy/excelParser.js';
import { createDeployBatch, getBatchView } from '../src/services/deploy/deployService.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-deploytarget-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  config.deployEnabled = true;
  config.actionGuardEnabled = true;
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('部署目标字段透传（SSH 端口 / 设备绑定 / 模型配置）', () => {
  it('createDeployBatch 落库 port/deviceId/modelConfigs（密码仍不落库）', () => {
    const parsed = parseTargetsFromObjects([
      {
        ip: '10.0.0.9',
        user: 'root',
        password: 'pw',
        port: '2222',
        deviceId: 'dev-1',
        platforms: 'codex',
        models: 'codex=kimi/k3,glm/strong',
      },
    ]);
    const res = createDeployBatch('qa-port', parsed.targets, parsed.invalidRows);
    const batch = getBatchView(res.batchId);
    const target = batch?.targets[0];
    expect(target?.port).toBe(2222);
    expect(target?.deviceId).toBe('dev-1');
    expect(target?.modelConfigs).toEqual([
      { agentType: 'codex', model: 'kimi/k3', fallbacks: ['glm/strong'] },
    ]);
    expect((target as Record<string, unknown>).password).toBeUndefined();
  });
});
