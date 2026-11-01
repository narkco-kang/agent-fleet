import { config } from '../../config.js';

/**
 * modelgateway 协议对接客户端（可选后端）。
 *
 * - 端点：POST /v1/chat/completions（OpenAI chat completions 协议）
 * - 请求头：x-mg-agent / x-mg-session / x-mg-platform / x-mg-task
 * - 响应：stream:false → JSON；stream:true → SSE（text/event-stream）
 * - 响应头：x-mg-provider（命中 provider）/ x-mg-degraded / x-mg-capability
 * - Node 20+ 原生 fetch，零新依赖；modelgateway 离线时标记不可用，roleRouter 降级本地。
 */

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** chat.completions 请求体 */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  /** x-mg-agent：bot 展示名 */
  agent?: string;
  /** x-mg-session：会话 id */
  sessionId?: string;
  /** x-mg-platform：默认 dsh */
  platform?: string;
  /** x-mg-task：已登记 taskId */
  taskId?: string;
}

/** chat.completions 响应（归一化） */
export interface ChatCompletionResponse {
  id?: string;
  model: string;
  text: string;
  provider?: string;
  degraded?: boolean;
  capability?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** 流式增量 chunk */
export interface StreamChunk {
  done: boolean;
  delta: string;
  model?: string;
  provider?: string;
  usage?: ChatCompletionResponse['usage'];
}

/**
 * 解析一段 SSE 原始文本为增量 chunk（纯函数，便于单测）。
 * 兼容 `data: {...}` 多行事件与 `[DONE]` 结束标记。
 */
export function parseSseChunk(buffer: string): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (const rawLine of buffer.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === '[DONE]') {
      chunks.push({ done: true, delta: '' });
      continue;
    }
    try {
      const json = JSON.parse(data) as {
        model?: string;
        choices?: Array<{ delta?: { content?: string }; text?: string }>;
        usage?: ChatCompletionResponse['usage'];
      };
      const delta =
        json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
      chunks.push({
        done: false,
        delta,
        model: json.model,
        usage: json.usage,
      });
    } catch {
      // 忽略无法解析的 data 行（容错）
    }
  }
  return chunks;
}

/** 从 OpenAI 风格 JSON 响应中提取文本（归一化，兼容 message.content / text） */
export function extractText(json: unknown): string {
  const obj = json as {
    choices?: Array<{ message?: { content?: string }; text?: string; delta?: { content?: string } }>;
  };
  const choice = obj?.choices?.[0];
  if (!choice) return '';
  return choice.message?.content ?? choice.text ?? choice.delta?.content ?? '';
}

class ModelGatewayClient {
  private available = true;

  /** 是否配置了 modelgateway */
  isConfigured(): boolean {
    return Boolean(config.modelGatewayUrl);
  }

  /** 是否可用（配置 + 最近一次探测/请求未失败） */
  isAvailable(): boolean {
    return this.isConfigured() && this.available;
  }

  markAvailable(): void {
    this.available = true;
  }

  markUnavailable(): void {
    this.available = false;
  }

  /** 构建统一请求头 */
  private buildHeaders(body: ChatCompletionRequest, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    };
    if (body.agent) headers['x-mg-agent'] = body.agent;
    if (body.sessionId) headers['x-mg-session'] = body.sessionId;
    headers['x-mg-platform'] = body.platform ?? 'dsh';
    if (body.taskId) headers['x-mg-task'] = body.taskId;
    return headers;
  }

  /** 构造请求 body */
  private buildBody(body: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {
      model: body.model,
      messages: body.messages,
      stream,
    };
    if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
    if (body.temperature !== undefined) out.temperature = body.temperature;
    return out;
  }

  /** 非流式调用（stream:false → JSON） */
  async chatCompletions(
    body: ChatCompletionRequest,
    opts: { signal?: AbortSignal } = {},
  ): Promise<ChatCompletionResponse> {
    if (!this.isConfigured()) {
      throw new Error('modelgateway 未配置');
    }
    const url = `${config.modelGatewayUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(body, false),
      body: JSON.stringify(this.buildBody(body, false)),
      signal: opts.signal,
    });

    const provider = res.headers.get('x-mg-provider') ?? undefined;
    const degraded = res.headers.get('x-mg-degraded') === 'true';
    const capability = res.headers.get('x-mg-capability') ?? undefined;

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      this.markUnavailable();
      throw new Error(`modelgateway ${res.status}: ${detail}`);
    }

    this.markAvailable();
    const json = (await res.json()) as Record<string, unknown>;
    const usage = json.usage as ChatCompletionResponse['usage'];
    return {
      id: typeof json.id === 'string' ? json.id : undefined,
      model: typeof json.model === 'string' ? json.model : body.model,
      text: extractText(json),
      provider,
      degraded,
      capability,
      usage,
    };
  }

  /** 流式调用（stream:true → SSE），返回异步迭代器 */
  async *streamCompletions(
    body: ChatCompletionRequest,
    opts: { signal?: AbortSignal } = {},
  ): AsyncIterable<StreamChunk> {
    if (!this.isConfigured()) {
      throw new Error('modelgateway 未配置');
    }
    const url = `${config.modelGatewayUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(body, true),
      body: JSON.stringify(this.buildBody(body, true)),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => res.statusText);
      this.markUnavailable();
      throw new Error(`modelgateway ${res.status}: ${detail}`);
    }

    this.markAvailable();
    const provider = res.headers.get('x-mg-provider') ?? undefined;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const chunks = parseSseChunk(line);
        for (const c of chunks) {
          if (c.done) {
            finished = true;
            yield { done: true, delta: '', provider };
            return;
          }
          yield { ...c, provider };
        }
      }
    }
    // 流结束但未收到 [DONE]：补发一个结束标记
    yield { done: true, delta: '', provider };
  }

  /** 健康探测（GET /health） */
  async health(timeoutMs = config.modelGatewayTimeoutMs): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${config.modelGatewayUrl.replace(/\/$/, '')}/health`, {
        signal: ctrl.signal,
      });
      const ok = res.ok;
      if (ok) this.markAvailable();
      else this.markUnavailable();
      return ok;
    } catch {
      this.markUnavailable();
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 全局单例 */
export const modelGatewayClient = new ModelGatewayClient();
