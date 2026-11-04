import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProviderPool, ProviderConfig } from './providers.js';
import type { MgHeaders } from './openai.js';

/**
 * OpenAI Responses API → chat.completions 转换层。
 *
 * 背景：新版 Codex CLI（0.18+）只支持 Responses API（`wire_api = "responses"`），
 * 而免费源（kilo/opencode）只提供 chat.completions。本模块把 codex 的 responses 请求
 * 转换为 chat.completions 请求转发到上游，再把响应转回 responses 格式，让 codex
 * 免登录直连免费源（「一键配置模型」的核心）。
 *
 * 仅实现非流式（stream:false）：codex exec 单轮（textOutput）场景足够；流式后续按需补。
 */

interface ResponsesBody {
  model: string;
  input?: string | Array<{ role?: string; content?: string | Array<{ type?: string; text?: string }> }>;
  instructions?: string;
  stream?: boolean;
  max_output_tokens?: number;
  temperature?: number;
}

/** input/instructions → chat.completions messages */
function toMessages(body: ResponsesBody): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (body.instructions?.trim()) {
    messages.push({ role: 'system', content: body.instructions.trim() });
  }
  if (typeof body.input === 'string') {
    if (body.input.trim()) messages.push({ role: 'user', content: body.input.trim() });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      const content =
        typeof item.content === 'string'
          ? item.content
          : (item.content ?? []).map((c) => c.text ?? '').join('');
      if (content.trim()) messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content });
    }
  }
  return messages;
}

/** chat.completions 响应 → Responses API 响应 */
function toResponses(chatJson: {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}): Record<string, unknown> {
  const choice = chatJson.choices?.[0];
  const text = (choice?.message?.content ?? '').trim();
  const usage = chatJson.usage;
  return {
    id: `resp_${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: chatJson.model ?? '',
    output: text
      ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }]
      : [],
    usage: usage
      ? {
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
          total_tokens: usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

function buildAuthHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (provider.auth === 'bearer-public') {
    headers.Authorization = 'Bearer public';
  } else if (provider.auth === 'bearer' && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

export class ResponsesHandler {
  constructor(private readonly pool: ProviderPool) {}

  async handle(
    _req: IncomingMessage,
    res: ServerResponse,
    body: ResponsesBody,
    mg: MgHeaders,
  ): Promise<void> {
    if (!body || typeof body.model !== 'string' || !body.model) {
      this.sendError(res, 400, 'model required');
      return;
    }
    const messages = toMessages(body);
    if (messages.length === 0) {
      this.sendError(res, 400, 'input required');
      return;
    }

    let resolution;
    try {
      resolution = this.pool.resolve(body.model);
    } catch (err) {
      this.sendError(res, 500, (err as Error).message);
      return;
    }
    const provider = resolution.provider;
    const upstreamBody: Record<string, unknown> = {
      model: resolution.outModel,
      messages,
      stream: false,
    };
    if (body.max_output_tokens !== undefined) upstreamBody.max_tokens = body.max_output_tokens;
    if (body.temperature !== undefined) upstreamBody.temperature = body.temperature;

    const passthrough: Record<string, string> = {};
    if (mg.agent) passthrough['x-mg-agent'] = mg.agent;
    if (mg.session) passthrough['x-mg-session'] = mg.session;
    if (mg.platform) passthrough['x-mg-platform'] = mg.platform;
    if (mg.task) passthrough['x-mg-task'] = mg.task;

    try {
      const upstream = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { ...buildAuthHeaders(provider), ...passthrough },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(300_000),
      });
      const raw = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(raw);
        return;
      }
      let chatJson: Record<string, unknown> = {};
      try {
        chatJson = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        /* 非 JSON 响应 → 返回原文包装 */
      }
      const responsesJson = toResponses(chatJson as never);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-mg-provider': provider.id,
        'x-mg-capability': 'responses',
      });
      res.end(JSON.stringify(responsesJson));
    } catch (err) {
      if (!res.headersSent) {
        this.sendError(res, 502, (err as Error).message);
      } else {
        res.end();
      }
    }
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'modelgateway_error' } }));
  }
}
