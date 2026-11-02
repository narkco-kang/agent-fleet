import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DIRECT_FREE_SOURCES,
  computeRating,
  directFreeChat,
  extractCompletionText,
  getDirectSource,
  isAliveCompletion,
  keepRating,
  listDirectModels,
  parseFreeModelIds,
  parseModelIds,
  probeDirectSource,
} from '@agentfleet/shared';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            { id: 'kilo-auto/free', isFree: true, pricing: { prompt: '0', completion: '0' } },
            { id: 'paid/model', isFree: false, pricing: { prompt: '1', completion: '1' } },
            { id: 'zero/cost', pricing: { prompt: '0', completion: '0' } },
          ],
        }),
      );
      return;
    }
    if (req.url === '/chat/completions' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as { model: string; messages: Array<{ content: string }> };
        if (body.model === 'limited') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'FreeUsageLimitError', message: 'free usage limit reached' } }));
          return;
        }
        if (body.model === 'bad') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('upstream failed');
          return;
        }
        if (body.model === 'reasoning-only') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: '', reasoning: 'thinking...' }, finish_reason: 'length' }],
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('直连免费源目录（参考 dsh-our-free-model）', () => {
  it('内置 Kilo / OpenCode 两个公开免密源', () => {
    expect(DIRECT_FREE_SOURCES.map((s) => s.id)).toEqual(['kilo-free', 'opencode-free']);
    expect(getDirectSource('kilo-free')?.baseUrl).toContain('api.kilo.ai');
    expect(getDirectSource('opencode-free')?.auth).toBe('bearer-public');
    expect(getDirectSource('nope')).toBeUndefined();
  });

  it('解析模型池与免费模型', () => {
    const json = {
      data: [
        { id: 'kilo-auto/free', isFree: true },
        { id: 'paid/model', isFree: false, pricing: { prompt: '1', completion: '1' } },
        { id: 'zero/cost', pricing: { prompt: '0', completion: '0' } },
      ],
    };
    expect(parseModelIds(json)).toEqual(['kilo-auto/free', 'paid/model', 'zero/cost']);
    expect(parseFreeModelIds(json)).toEqual(['kilo-auto/free', 'zero/cost']);
  });

  it('思考型模型只有 reasoning 也算活响应', () => {
    const json = { choices: [{ message: { content: '', reasoning: 'thinking' }, finish_reason: 'length' }] };
    expect(isAliveCompletion(json)).toBe(true);
    expect(extractCompletionText(json)).toBe('thinking');
    expect(isAliveCompletion({ choices: [] })).toBe(false);
  });

  it('listDirectModels 拉取模型池', async () => {
    const res = await listDirectModels('kilo-free', { baseUrl });
    expect(res.ok).toBe(true);
    expect(res.freeModels).toEqual(['kilo-auto/free', 'zero/cost']);
  });

  it('probeDirectSource：正常 / 仅 reasoning / 429 / 500', async () => {
    const ok = await probeDirectSource('kilo-free', 'kilo-auto/free', { baseUrl });
    expect(ok.ok).toBe(true);
    expect(ok.text).toBe('pong');

    const reasoning = await probeDirectSource('kilo-free', 'reasoning-only', { baseUrl });
    expect(reasoning.ok).toBe(true);

    const limited = await probeDirectSource('kilo-free', 'limited', { baseUrl });
    expect(limited.ok).toBe(false);
    expect(limited.status).toBe(429);
    expect(limited.quotaLimited).toBe(true);

    const bad = await probeDirectSource('kilo-free', 'bad', { baseUrl });
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(500);
  });

  it('directFreeChat 可作为 modelgateway 免费线路失败时的兜底', async () => {
    const res = await directFreeChat(
      { sourceId: 'kilo-free', model: 'kilo-auto/free', messages: [{ role: 'user', content: 'ping' }] },
      { baseUrl },
    );
    expect(res.ok).toBe(true);
    expect(res.text).toBe('pong');
    expect(res.usage?.total_tokens).toBe(4);
    expect(res.provider).toContain('kilo-free');
  });

  it('免费源评级：优/中/差 + 只保留优中', () => {
    expect(computeRating({ ok: true, latencyMs: 300 })).toBe('excellent');
    expect(computeRating({ ok: true, latencyMs: 2500 })).toBe('medium');
    expect(computeRating({ ok: false, latencyMs: 100 })).toBe('poor');
    expect(computeRating({ ok: true, latencyMs: 100, quotaLimited: true })).toBe('poor');
    expect(keepRating('excellent')).toBe(true);
    expect(keepRating('medium')).toBe(true);
    expect(keepRating('poor')).toBe(false);
  });

  it('probeDirectSource 返回评级字段', async () => {
    const ok = await probeDirectSource('kilo-free', 'kilo-auto/free', { baseUrl });
    expect(ok.rating).toBe('excellent');
    const limited = await probeDirectSource('kilo-free', 'limited', { baseUrl });
    expect(limited.rating).toBe('poor');
  });
});
