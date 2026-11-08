import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 集成冒烟：用 tsx 真实拉起内置 modelgateway 入口（与 GatewayManager 一致），
 * 在临时端口上验证 /health、/v1/models、/v1/checkin、/v1/chat/completions。
 * 注意：默认 18765 端口在测试机被旧进程占用，必须用随机空闲端口。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const gatewayEntry = path.join(rootDir, 'modelgateway', 'src', 'index.ts');
const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`modelgateway 健康探测超时: ${lastErr}`);
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

let port: number;
let baseUrl = '';
let child: ChildProcess;

beforeAll(async () => {
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [tsxCli, gatewayEntry], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      MODELGATEWAY_PORT: String(port),
      MODELGATEWAY_HOST: '127.0.0.1',
      MG_PAID_PROVIDERS: '[]',
      // 彻底隔离本机 .workbuddy-ai 下的付费 provider / 别名配置
      MODELGATEWAY_LOCAL_CONFIG: '0',
    },
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  await waitForHealthy(baseUrl, 20_000).catch(async (err) => {
    const msg = `${(err as Error).message}\n--- gateway stderr ---\n${stderr.slice(-2000)}`;
    throw new Error(msg);
  });
}, 30_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

describe('内置 modelgateway 集成冒烟（临时端口）', () => {
  it('GET /health 返回 200 {ok,version,uptimeMs,providers,defaultModel}', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      version: string;
      uptimeMs: number;
      providers: unknown[];
      defaultModel: string;
      aliasCount: number;
      modelAliases: Record<string, string>;
    };
    expect(json.ok).toBe(true);
    expect(typeof json.version).toBe('string');
    expect(json.version).toBe('0.1.0');
    expect(typeof json.uptimeMs).toBe('number');
    expect(Array.isArray(json.providers)).toBe(true);
    // 无付费 provider 时内置 Kilo + OpenCode 两个直连免费源
    expect(json.providers).toHaveLength(2);
    expect(json.defaultModel).toBe('kilo-auto/free');
    // 隔离本机配置后无业务别名
    expect(json.aliasCount).toBe(0);
    expect(json.modelAliases).toEqual({});
  });

  it('GET /v1/models 返回聚合模型列表（OpenAI data 结构）', async () => {
    const res = await fetch(`${baseUrl}/v1/models`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { object: string; data: Array<{ id: string; object: string; owned_by: string }> };
    expect(json.object).toBe('list');
    const ids = json.data.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['kilo-auto/free', 'big-pickle', 'beam-free']));
    for (const m of json.data) expect(m.object).toBe('model');
  });

  it('POST /v1/checkin 与 /v1/free/checkin 均返回 {ok:true}', async () => {
    for (const endpoint of ['/v1/checkin', '/v1/free/checkin']) {
      const res = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(200);
      expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
    }
  });

  it('POST /v1/chat/completions 非流式：未命中模型走降级，响应头含 x-mg-provider/x-mg-degraded/x-mg-capability', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mg-agent': 'QA', 'x-mg-session': 'qa-s1' },
      body: JSON.stringify({
        model: 'definitely-not-a-real-model-xyz',
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        max_tokens: 8,
      }),
    });
    // 验证降级逻辑与响应头接线；不强求真实返回内容（上游免费源可能超时/429）
    expect(res.headers.get('x-mg-provider')).toBe('kilo-free');
    expect(res.headers.get('x-mg-degraded')).toBe('true');
    expect(res.headers.get('x-mg-capability')).toBe('chat');
  });

  it('未知路由返回 404 {ok:false,error:not_found}', async () => {
    const res = await fetch(`${baseUrl}/no/such/path`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toMatchObject({ ok: false, error: 'not_found' });
  });
});
