import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ProviderPool, ProviderConfig } from './providers.js';

/**
 * OpenAI chat.completions 处理器：
 * - stream:false → OpenAI JSON（透传上游 + x-mg-* 响应头）
 * - stream:true  → SSE（data: + [DONE]）
 * 响应头：x-mg-provider / x-mg-degraded / x-mg-capability。
 */

export interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

/** 透传的 x-mg-* 请求头 */
export interface MgHeaders {
  agent?: string;
  session?: string;
  platform?: string;
  task?: string;
}

function buildAuthHeaders(provider: ProviderConfig, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
  };
  if (provider.auth === 'bearer-public') {
    headers.Authorization = 'Bearer public';
  } else if (provider.auth === 'bearer' && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

/** 把 x-mg-* 头透传给上游（遥测），空值跳过 */
function passthroughMgHeaders(mg: MgHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  if (mg.agent) headers['x-mg-agent'] = mg.agent;
  if (mg.session) headers['x-mg-session'] = mg.session;
  if (mg.platform) headers['x-mg-platform'] = mg.platform;
  if (mg.task) headers['x-mg-task'] = mg.task;
  return headers;
}

function upstreamUrl(provider: ProviderConfig): string {
  return `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
}

export class OpenAIHandler {
  constructor(private readonly pool: ProviderPool) {}

  async handleChat(
    _req: IncomingMessage,
    res: ServerResponse,
    body: ChatBody,
    mg: MgHeaders,
  ): Promise<void> {
    if (!body || typeof body.model !== 'string' || !body.model) {
      this.sendError(res, 400, 'model required');
      return;
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
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
      messages: body.messages,
      stream: body.stream === true,
    };
    if (body.max_tokens !== undefined) upstreamBody.max_tokens = body.max_tokens;
    if (body.temperature !== undefined) upstreamBody.temperature = body.temperature;

    const stream = body.stream === true;
    try {
      const upstream = await fetch(upstreamUrl(provider), {
        method: 'POST',
        headers: { ...buildAuthHeaders(provider, stream), ...passthroughMgHeaders(mg) },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(300_000),
      });

      if (stream) {
        await this.stream(res, provider, resolution.degraded, upstream);
      } else {
        await this.nonStream(res, provider, resolution.degraded, upstream);
      }
    } catch (err) {
      if (!res.headersSent) {
        this.sendError(res, 502, (err as Error).message);
      } else {
        res.end();
      }
    }
  }

  private async nonStream(
    res: ServerResponse,
    provider: ProviderConfig,
    degraded: boolean,
    upstream: Response,
  ): Promise<void> {
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json',
      'x-mg-provider': provider.id,
      ...(degraded ? { 'x-mg-degraded': 'true' } : {}),
      'x-mg-capability': 'chat',
    });
    res.end(text);
  }

  private async stream(
    res: ServerResponse,
    provider: ProviderConfig,
    degraded: boolean,
    upstream: Response,
  ): Promise<void> {
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => upstream.statusText);
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'x-mg-provider': provider.id,
        ...(degraded ? { 'x-mg-degraded': 'true' } : {}),
        'x-mg-capability': 'chat',
      });
      res.end(text || upstream.statusText);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-mg-provider': provider.id,
      ...(degraded ? { 'x-mg-degraded': 'true' } : {}),
      'x-mg-capability': 'chat',
    });

    const nodeStream = Readable.fromWeb(upstream.body as never);
    nodeStream.on('error', () => res.end());
    nodeStream.pipe(res);
  }

  private sendError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'modelgateway_error' } }));
  }
}
