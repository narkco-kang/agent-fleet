import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  extractText,
  modelGatewayClient,
  parseSseChunk,
} from '../src/services/routing/modelGatewayClient.js';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw) as { stream?: boolean };
        const headers: Record<string, string> = { 'x-mg-provider': 'kimi' };
        if (body.stream) {
          headers['Content-Type'] = 'text/event-stream';
          res.writeHead(200, headers);
          res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          headers['Content-Type'] = 'application/json';
          res.writeHead(200, headers);
          res.end(
            JSON.stringify({
              id: 'cmpl-1',
              model: body.model,
              choices: [{ message: { role: 'assistant', content: '你好' } }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }),
          );
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
  config.modelGatewayUrl = baseUrl;
  modelGatewayClient.markAvailable();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('modelGatewayClient 协议对接', () => {
  it('parseSseChunk 解析增量与 [DONE]', () => {
    const chunks = parseSseChunk('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ done: false, delta: 'hi' });
    expect(chunks[1]).toMatchObject({ done: true });
  });

  it('extractText 提取 OpenAI message.content', () => {
    expect(extractText({ choices: [{ message: { content: 'abc' } }] })).toBe('abc');
  });

  it('chatCompletions（stream:false）解析 JSON + x-mg-provider', async () => {
    const res = await modelGatewayClient.chatCompletions({
      model: 'kimi/k3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
    expect(res.text).toBe('你好');
    expect(res.provider).toBe('kimi');
    expect(res.usage?.prompt_tokens).toBe(10);
  });

  it('streamCompletions（stream:true）解析 SSE 流', async () => {
    let text = '';
    let doneCount = 0;
    for await (const chunk of modelGatewayClient.streamCompletions({
      model: 'kimi/k3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })) {
      text += chunk.delta;
      if (chunk.done) doneCount++;
    }
    expect(text).toBe('你好');
    expect(doneCount).toBe(1);
  });

  it('health 探测返回 true', async () => {
    expect(await modelGatewayClient.health()).toBe(true);
  });
});
