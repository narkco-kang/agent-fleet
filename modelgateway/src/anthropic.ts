import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProviderPool, ProviderConfig } from './providers.js';
import type { MgHeaders } from './openai.js';

/**
 * Anthropic Messages API → OpenAI chat.completions 转换层。
 *
 * 背景：Claude Code 需要 Anthropic Messages 协议（/v1/messages），而免费源目录里的
 * free 类源大多是 openai-chat 协议。本模块把 claude code 的 messages 请求转成
 * chat.completions 请求转发到上游（如 opencode_zen 的 claude-fable-5），再把响应
 * 转回 Anthropic Messages 格式，让 claude code 免登录走免费源跑任务。
 *
 * 仅非流式（stream:false）；流式后续按需补。
 */

interface AnthropicBody {
  model: string;
  messages?: Array<{ role?: string; content?: string | Array<{ type?: string; text?: string }> }>;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

/** 提取 anthropic content（string 或 blocks）为纯文本 */
function contentText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => c.text ?? '').join('');
  return '';
}

/** anthropic body → openai chat messages */
function toOpenAiMessages(body: AnthropicBody): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (body.system?.trim()) messages.push({ role: 'system', content: body.system.trim() });
  for (const m of body.messages ?? []) {
    const text = contentText(m.content);
    if (text.trim()) messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
  }
  return messages;
}

/** openai chat 响应 → anthropic messages 响应 */
function toAnthropicResponse(chatJson: {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}): Record<string, unknown> {
  const text = (chatJson.choices?.[0]?.message?.content ?? '').trim();
  const usage = chatJson.usage;
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: chatJson.model ?? '',
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
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

export class AnthropicHandler {
  constructor(private readonly pool: ProviderPool) {}

  async handle(
    _req: IncomingMessage,
    res: ServerResponse,
    body: AnthropicBody,
    mg: MgHeaders,
  ): Promise<void> {
    if (!body || typeof body.model !== 'string' || !body.model) {
      this.sendError(res, 400, 'model required');
      return;
    }
    const messages = toOpenAiMessages(body);
    if (messages.length === 0) {
      this.sendError(res, 400, 'messages required');
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
    if (body.max_tokens !== undefined) upstreamBody.max_tokens = body.max_tokens;
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
        /* 非 JSON */
      }
      const anthJson = toAnthropicResponse(chatJson as never);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-mg-provider': provider.id,
        'x-mg-capability': 'anthropic-messages',
      });
      res.end(JSON.stringify(anthJson));
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
