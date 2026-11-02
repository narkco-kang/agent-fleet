import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents } from '../src/db/repo/agents.js';
import { upsertDevice } from '../src/db/repo/devices.js';
import { modelGatewayClient } from '../src/services/routing/modelGatewayClient.js';
import * as platformModelService from '../src/services/routing/platformModelService.js';
import { listUsageRecords } from '../src/services/routing/usageLedger.js';
import { enqueueTask, setSchedulerHooks, type GatewayTaskResult } from '../src/services/scheduler.js';

/**
 * 平台模型故障自动切换：主模型 500 → 自动切兜底模型 200 → 任务完成。
 */

let tmpDir: string;
let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-failover-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();

  server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (c) => (raw += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as { model: string };
        if (body.model === 'bad-model') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('model down');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'cmpl-ok',
            model: body.model,
            choices: [{ message: { role: 'assistant', content: 'pong' } }],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.modelGatewayUrl = baseUrl;
  modelGatewayClient.markAvailable();
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('平台模型故障自动切换（主模型失败 → 兜底模型）', () => {
  it('主模型 500 → 自动切换兜底模型 → 任务完成', async () => {
    deviceRegistry.register('dev-codex', 'Dev Codex', 'relay');
    upsertDevice({
      deviceId: 'dev-codex',
      name: 'Dev Codex',
      hostname: 'dev-codex',
      os: { platform: 'darwin', arch: 'arm64', release: '25.0' },
      version: '0.1.0',
    });
    upsertAgents('dev-codex', [
      {
        agentType: 'codex',
        displayName: 'codex',
        version: '1.0.0',
        executable: 'codex',
        status: 'available',
        detectMethod: 'which',
        capabilities: [],
        maxConcurrency: 1,
      },
    ]);
    platformModelService.bind('dev-codex', 'codex', 'bad-model', ['good-model']);

    const completed = new Promise<GatewayTaskResult>((resolve) => {
      setSchedulerHooks({
        onDispatched: () => undefined,
        onEvent: () => undefined,
        onGatewayCompleted: (_taskId, result) => resolve(result),
      });
    });

    enqueueTask({
      taskId: 'task-failover-1',
      sessionId: 'sess-failover-1',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: 'ping',
      targetMode: 'agent',
      targetAgentType: 'codex',
    });

    const result = await completed;
    expect(result.status).toBe('completed');
    expect(result.resultText).toBe('pong');

    // 绑定已切到兜底模型
    const b = platformModelService.resolve('dev-codex', 'codex');
    expect(b?.activeModel).toBe('good-model');
    expect(b?.state).toBe('ok');

    // 台账记录
    const usage = listUsageRecords().filter((u) => u.task_id === 'task-failover-1');
    expect(usage).toHaveLength(1);
    expect(usage[0].model).toBe('good-model');

    deviceRegistry.remove('dev-codex');
  });
});
