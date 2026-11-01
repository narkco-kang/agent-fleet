import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { modelGatewayClient } from '../src/services/routing/modelGatewayClient.js';
import { checkin, status } from '../src/services/routing/checkinService.js';
import { listCheckins } from '../src/db/repo/checkins.js';

let tmpDir: string;
let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmesh-checkin-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();

  server = http.createServer((req, res) => {
    if (req.url === '/v1/free/checkin' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.modelGatewayUrl = baseUrl;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('免费源自动签到', () => {
  it('网关免费线路签到成功并落审计记录', async () => {
    const results = await checkin('gateway-free');
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].sourceId).toBe('gateway-free');

    const records = listCheckins('gateway-free');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('ok');
  });

  it('未配置的 HTTP 签到源（OpenCode）默认禁用', async () => {
    const results = await checkin('opencode-quota');
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('disabled');
  });

  it('status() 返回源列表 + 最近记录', () => {
    const s = status();
    expect(s.sources.map((x) => x.id)).toContain('gateway-free');
    expect(s.sources.map((x) => x.id)).toContain('opencode-quota');
    expect(s.records.length).toBeGreaterThanOrEqual(2);
  });

  it('modelgateway 未配置时 gateway-free 源禁用', () => {
    config.modelGatewayUrl = '';
    const s = status();
    const gw = s.sources.find((x) => x.id === 'gateway-free');
    expect(gw?.enabled).toBe(false);
    config.modelGatewayUrl = baseUrl;
    modelGatewayClient.markAvailable();
  });
});
