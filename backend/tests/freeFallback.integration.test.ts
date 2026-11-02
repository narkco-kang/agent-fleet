import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { roleRouteStore } from '../src/services/routing/roleRouteStore.js';
import { modelGatewayClient } from '../src/services/routing/modelGatewayClient.js';
import { listUsageRecords } from '../src/services/routing/usageLedger.js';
import { enqueueTask, setSchedulerHooks, type GatewayTaskResult } from '../src/services/scheduler.js';

/**
 * 免费源兜底链路：
 * modelgateway 免费线路返回 ALL_FAILED(502) → AgentFleet 直连 Kilo 免费源执行成功。
 */

let tmpDir: string;
let gwServer: http.Server;
let kiloServer: http.Server;
let gwUrl = '';
let kiloUrl = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-free-fallback-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();

  gwServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end('{"error":"全部线路失败","code":"ALL_FAILED","tried":[]}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  kiloServer = http.createServer((req, res) => {
    if (req.url === '/chat/completions') {
      let raw = '';
      req.on('data', (c) => (raw += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as { model: string };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'gen_test',
            model: body.model,
            choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((r) => gwServer.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => kiloServer.listen(0, '127.0.0.1', r));
  gwUrl = `http://127.0.0.1:${(gwServer.address() as AddressInfo).port}`;
  kiloUrl = `http://127.0.0.1:${(kiloServer.address() as AddressInfo).port}`;
  config.modelGatewayUrl = gwUrl;
  modelGatewayClient.markAvailable();
  process.env.FREE_KILO_BASE_URL = kiloUrl;
});

afterAll(async () => {
  delete process.env.FREE_KILO_BASE_URL;
  await new Promise<void>((r) => gwServer.close(() => r()));
  await new Promise<void>((r) => kiloServer.close(() => r()));
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('免费源兜底（modelgateway ALL_FAILED → 直连 Kilo）', () => {
  it('免费角色任务经网关失败后自动走直连免费源完成', async () => {
    roleRouteStore.set({
      role: 'free-tier',
      primary: 'free-models/kilo-auto/free',
      fallback: [],
      capability: 'chat',
      bots: ['Free仔'],
      enabled: true,
    });

    const completed = new Promise<GatewayTaskResult>((resolve) => {
      setSchedulerHooks({
        onDispatched: () => undefined,
        onEvent: () => undefined,
        onGatewayCompleted: (_taskId, result) => resolve(result),
      });
    });

    enqueueTask({
      taskId: 'task-free-1',
      sessionId: 'sess-free-1',
      origin: 'dashboard',
      originRef: 'qa',
      prompt: 'ping',
      targetMode: 'role',
      targetRole: 'free-tier',
    });

    const result = await completed;
    expect(result.status).toBe('completed');
    expect(result.resultText).toBe('pong');
    expect(result.tokensIn).toBe(5);

    const usage = listUsageRecords().filter((u) => u.task_id === 'task-free-1');
    expect(usage).toHaveLength(1);
    expect(usage[0].provider).toContain('kilo-free');
  });
});
