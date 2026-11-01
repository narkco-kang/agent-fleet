import type { IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaidProviderConfig } from '../src/config.js';
import { OpenAIHandler, type ChatBody, type MgHeaders } from '../src/openai.js';
import { ProviderPool } from '../src/providers.js';

/**
 * 捕获 ServerResponse 的 writeHead/end 行为，供 OpenAIHandler 单测使用。
 * 继承 Writable 以便 stream 路径的 `Readable.pipe(res)` 正常工作。
 */
class CaptureResponse extends Writable {
  statusCode = 0;
  headers: Record<string, string | string[] | undefined> = {};
  headersSent = false;
  private chunks: Buffer[] = [];

  constructor() {
    super();
  }

  _write(chunk: Buffer, _enc: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }

  writeHead(status: number, headers?: Record<string, string | string[] | undefined>): this {
    this.statusCode = status;
    if (headers) Object.assign(this.headers, headers);
    this.headersSent = true;
    return this;
  }

  end(chunk?: unknown): this {
    if (typeof chunk === 'string') this.chunks.push(Buffer.from(chunk));
    else if (Buffer.isBuffer(chunk)) this.chunks.push(chunk);
    super.end();
    return this;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  header(name: string): string | undefined {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(this.headers)) {
      if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
    }
    return undefined;
  }

  /** 等待流式写入完成（finish 事件） */
  finished(): Promise<void> {
    if (this.writableFinished) return Promise.resolve();
    return new Promise((resolve) => this.once('finish', resolve));
  }
}

function paid(opts: Partial<PaidProviderConfig> = {}): PaidProviderConfig {
  return {
    id: 'paid-x',
    label: 'Paid X',
    baseUrl: 'https://paid.example.com/v1',
    apiKey: 'sk-test',
    models: ['gpt-x'],
    ...opts,
  };
}

function jsonResponse(obj: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const mockReq = {} as IncomingMessage;
const mg: MgHeaders = { agent: 'AgentMeshProbe', session: 's1', platform: 'agentmesh', task: 't1' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenAIHandler 协议处理', () => {
  it('非流式：透传上游 OpenAI JSON + x-mg-provider/x-mg-capability 头（付费命中无 degraded）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'cmpl-1',
        object: 'chat.completion',
        model: 'gpt-x',
        choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const handler = new OpenAIHandler(new ProviderPool([paid()]));
    const res = new CaptureResponse();
    const body: ChatBody = { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8, temperature: 0 };
    await handler.handleChat(mockReq, res as never, body, mg);

    expect(res.statusCode).toBe(200);
    expect(res.header('x-mg-provider')).toBe('paid-x');
    expect(res.header('x-mg-capability')).toBe('chat');
    expect(res.header('x-mg-degraded')).toBeUndefined();

    const json = JSON.parse(res.text());
    expect(json.id).toBe('cmpl-1');
    expect(json.choices[0].message.content).toBe('你好');
    expect(json.usage.total_tokens).toBe(5);

    // 上游请求指向 provider baseUrl 的 /chat/completions
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://paid.example.com/v1/chat/completions');
    const upstreamBody = JSON.parse(String(init.body));
    expect(upstreamBody).toMatchObject({ model: 'gpt-x', stream: false, max_tokens: 8, temperature: 0 });
    // 付费 provider 带 Bearer 鉴权
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
  });

  it('非流式：模型未命中 → x-mg-degraded=true 且 provider 为 kilo-free', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'fallback' } }] })),
    );
    const handler = new OpenAIHandler(new ProviderPool());
    const res = new CaptureResponse();
    await handler.handleChat(mockReq, res as never, { model: 'unknown-model', messages: [{ role: 'user', content: 'x' }] }, mg);

    expect(res.statusCode).toBe(200);
    expect(res.header('x-mg-provider')).toBe('kilo-free');
    expect(res.header('x-mg-degraded')).toBe('true');
    expect(res.header('x-mg-capability')).toBe('chat');
  });

  it('流式：SSE 透传（data: + [DONE]），Content-Type=text/event-stream', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));

    const handler = new OpenAIHandler(new ProviderPool([paid()]));
    const res = new CaptureResponse();
    await handler.handleChat(
      mockReq,
      res as never,
      { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }], stream: true },
      mg,
    );
    await res.finished();

    expect(res.statusCode).toBe(200);
    expect(res.header('Content-Type')).toBe('text/event-stream');
    expect(res.header('x-mg-provider')).toBe('paid-x');
    const out = res.text();
    expect(out).toContain('data:');
    expect(out).toContain('[DONE]');
  });

  it('缺少 model → 400 model required', async () => {
    const handler = new OpenAIHandler(new ProviderPool());
    const res = new CaptureResponse();
    await handler.handleChat(mockReq, res as never, {} as ChatBody, mg);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.text()).error.message).toBe('model required');
  });

  it('缺少 messages → 400 messages required', async () => {
    const handler = new OpenAIHandler(new ProviderPool());
    const res = new CaptureResponse();
    await handler.handleChat(mockReq, res as never, { model: 'x', messages: [] }, mg);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.text()).error.message).toBe('messages required');
  });

  it('上游 fetch 抛错 → 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const handler = new OpenAIHandler(new ProviderPool([paid()]));
    const res = new CaptureResponse();
    await handler.handleChat(mockReq, res as never, { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }, mg);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.text()).error.type).toBe('modelgateway_error');
  });
});
