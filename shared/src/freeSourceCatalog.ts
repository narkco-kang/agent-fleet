/**
 * 直连免费源目录（参考 github.com/Ebony-Vinyl/dsh-our-free-model）。
 *
 * 与 modelgateway 的区别：
 * - modelgateway 是本地聚合网关（可能未配置免费线路，返回 ALL_FAILED）；
 * - 本模块直接对接公开免密上游（Kilo / OpenCode），用于「免费源是否真的可用」的真实探测，
 *   并在 modelgateway 免费线路不可用时作为兜底执行通道。
 *
 * 本模块为共享单一事实源：backend（免费源探测）与 modelgateway（内置 provider 池）均引用。
 *
 * 浏览器安全：`process.env` / `fetch` 仅在函数体内访问，模块顶层只声明纯数据，
 * 前端引入 shared 不触发浏览器顶层 `process`。
 *
 * 来源事实（2026-11 实测）：
 * - Kilo：GET/POST https://api.kilo.ai/api/gateway/v1/*，无需 Authorization，
 *   模型 `kilo-auto/free` 可正常返回（cost=0）。
 * - OpenCode：https://opencode.ai/inference/openai/v1，Authorization: Bearer public，
 *   存在免费额度限制，额度用尽返回 429 FreeUsageLimitError（需 OpenCode 客户端/订阅）。
 */

import type { FreeSourceRating } from './status.js';
import { computeRating } from './freeSourceRating.js';

export type DirectFreeAuth = 'none' | 'bearer-public';

export interface DirectFreeSource {
  id: string;
  label: string;
  /** OpenAI 兼容 base（含 /v1） */
  baseUrl: string;
  /** 默认可探测模型（可用 /models 动态补充） */
  models: string[];
  auth: DirectFreeAuth;
  /** 是否需要签到/额度刷新（OpenCode 免费额度按 session 计） */
  quotaBased: boolean;
  note: string;
  docs: string;
}

export const DIRECT_FREE_SOURCES: DirectFreeSource[] = [
  {
    id: 'kilo-free',
    label: 'Kilo Free Gateway',
    baseUrl: 'https://api.kilo.ai/api/gateway/v1',
    models: ['kilo-auto/free'],
    auth: 'none',
    quotaBased: false,
    note: '无需 Key；自动路由到免费模型池（cost=0）。上游可能记录 prompt 用于改进服务，勿发敏感数据。',
    docs: 'https://api.kilo.ai/api/gateway/models',
  },
  {
    id: 'opencode-free',
    label: 'OpenCode Free',
    baseUrl: 'https://opencode.ai/inference/openai/v1',
    models: ['big-pickle', 'beam-free'],
    auth: 'bearer-public',
    quotaBased: true,
    note: 'Bearer public 免密；免费额度按 session 限制，429 需在 OpenCode 客户端使用或订阅 OpenCode Go。',
    docs: 'https://opencode.ai/inference/v1/models',
  },
];

/** 按 id 查直连源 */
export function getDirectSource(id: string): DirectFreeSource | undefined {
  return DIRECT_FREE_SOURCES.find((s) => s.id === id);
}

/** 运行时 base URL（支持环境变量覆盖，便于自建镜像/测试） */
export function resolveBaseUrl(source: DirectFreeSource): string {
  const envKey =
    source.id === 'kilo-free'
      ? 'FREE_KILO_BASE_URL'
      : source.id === 'opencode-free'
        ? 'FREE_OPENCODE_BASE_URL'
        : '';
  // 用 globalThis 访问 process，避免浏览器类型环境（frontend 无 @types/node）报错
  const override = envKey
    ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[envKey]
    : undefined;
  return (override || source.baseUrl).replace(/\/$/, '');
}

/** 解析 /models 响应中的模型 id（兼容 OpenAI data 数组） */
export function parseModelIds(json: unknown): string[] {
  const obj = json as { data?: Array<{ id?: string }> };
  if (!Array.isArray(obj?.data)) return [];
  return obj.data.map((m) => m.id).filter((x): x is string => typeof x === 'string');
}

/** 解析免费模型（Kilo 的 isFree / cost=0，或 id 含 free） */
export function parseFreeModelIds(json: unknown): string[] {
  const obj = json as {
    data?: Array<{
      id?: string;
      isFree?: boolean;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };
  if (!Array.isArray(obj?.data)) return [];
  return obj.data
    .filter((m) => {
      if (typeof m.id !== 'string') return false;
      if (m.isFree === true) return true;
      if (m.id.includes('free')) return true;
      return m.pricing?.prompt === '0' && m.pricing?.completion === '0';
    })
    .map((m) => m.id as string);
}

/** 判断响应是否代表模型真的活着（content / reasoning / finish_reason 任一存在） */
export function isAliveCompletion(json: unknown): boolean {
  const obj = json as {
    choices?: Array<{
      message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null };
      text?: string;
      finish_reason?: string | null;
    }>;
  };
  const c = obj?.choices?.[0];
  if (!c) return false;
  if ((c.message?.content ?? '').trim()) return true;
  if ((c.message?.reasoning ?? '').trim()) return true;
  if ((c.message?.reasoning_content ?? '').trim()) return true;
  if ((c.text ?? '').trim()) return true;
  return Boolean(c.finish_reason);
}

/** 从响应中提取文本（content 优先，reasoning 兜底） */
export function extractCompletionText(json: unknown): string {
  const obj = json as {
    choices?: Array<{
      message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null };
      text?: string;
    }>;
  };
  const c = obj?.choices?.[0];
  const content = (c?.message?.content ?? '').trim();
  if (content) return content;
  const text = (c?.text ?? '').trim();
  if (text) return text;
  return (c?.message?.reasoning ?? c?.message?.reasoning_content ?? '').trim();
}

export interface DirectProbeResult {
  sourceId: string;
  label: string;
  model: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  text?: string;
  provider?: string;
  error?: string;
  /** 429 等额度限制（需签到/换客户端） */
  quotaLimited?: boolean;
  /** 401/403 需要授权 */
  authRequired?: boolean;
  /** 评级：优/中/差 */
  rating: FreeSourceRating;
}

export interface DirectChatResult {
  ok: boolean;
  status?: number;
  text: string;
  provider?: string;
  latencyMs: number;
  error?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function headersFor(source: DirectFreeSource, stream = false): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
  };
  if (source.auth === 'bearer-public') headers.Authorization = 'Bearer public';
  return headers;
}

/** 列出直连源的模型（含免费筛选） */
export async function listDirectModels(
  sourceId: string,
  opts: { timeoutMs?: number; baseUrl?: string } = {},
): Promise<{ ok: boolean; models: string[]; freeModels: string[]; status?: number; error?: string }> {
  const source = getDirectSource(sourceId);
  if (!source) return { ok: false, models: [], freeModels: [], error: 'source_not_found' };
  const timeoutMs = opts.timeoutMs ?? 8_000;
  try {
    const res = await fetch(`${(opts.baseUrl ?? resolveBaseUrl(source)).replace(/\/$/, '')}/models`, {
      headers: headersFor(source),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: false, models: [], freeModels: [], status: res.status, error: await res.text() };
    }
    const json = (await res.json()) as unknown;
    const models = parseModelIds(json);
    const freeModels = parseFreeModelIds(json);
    return { ok: true, models, freeModels };
  } catch (err) {
    return { ok: false, models: [], freeModels: [], error: (err as Error).message };
  }
}

/** 真实探测单个直连源（发最小 chat 请求） */
export async function probeDirectSource(
  sourceId: string,
  model?: string,
  opts: { timeoutMs?: number; baseUrl?: string } = {},
): Promise<DirectProbeResult> {
  const source = getDirectSource(sourceId);
  const started = Date.now();
  if (!source) {
    return {
      sourceId,
      label: sourceId,
      model: model ?? '',
      ok: false,
      latencyMs: 0,
      error: 'source_not_found',
      rating: 'poor',
    };
  }
  const targetModel = model ?? source.models[0];
  const timeoutMs = opts.timeoutMs ?? 15_000;
  try {
    const res = await fetch(`${(opts.baseUrl ?? resolveBaseUrl(source)).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: headersFor(source),
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 64,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        sourceId: source.id,
        label: source.label,
        model: targetModel,
        ok: false,
        status: res.status,
        latencyMs,
        error: raw.slice(0, 500),
        quotaLimited: res.status === 429,
        authRequired: res.status === 401 || res.status === 403,
        rating: computeRating({ ok: false, latencyMs, quotaLimited: res.status === 429 }),
      };
    }
    let json: unknown = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      return {
        sourceId: source.id,
        label: source.label,
        model: targetModel,
        ok: false,
        status: res.status,
        latencyMs,
        error: 'invalid_json_response',
        rating: computeRating({ ok: false, latencyMs }),
      };
    }
    const text = extractCompletionText(json);
    const ok = isAliveCompletion(json);
    return {
      sourceId: source.id,
      label: source.label,
      model: targetModel,
      ok,
      status: res.status,
      latencyMs,
      text: text.slice(0, 200),
      provider: source.id,
      error: ok ? undefined : 'empty_model_response',
      rating: computeRating({ ok, latencyMs }),
    };
  } catch (err) {
    return {
      sourceId: source.id,
      label: source.label,
      model: targetModel,
      ok: false,
      latencyMs: Date.now() - started,
      error: (err as Error).message,
      rating: 'poor',
    };
  }
}

/** 批量探测所有直连源（逐个隔离失败） */
export async function probeAllDirectSources(
  opts: { timeoutMs?: number } = {},
): Promise<DirectProbeResult[]> {
  const results: DirectProbeResult[] = [];
  for (const source of DIRECT_FREE_SOURCES) {
    results.push(await probeDirectSource(source.id, source.models[0], opts));
  }
  return results;
}

/** 直连 chat（供 modelgateway 免费线路失败时兜底） */
export async function directFreeChat(
  input: { sourceId?: string; model?: string; messages: Array<{ role: string; content: string }> },
  opts: { timeoutMs?: number; baseUrl?: string } = {},
): Promise<DirectChatResult> {
  const source = getDirectSource(input.sourceId ?? 'kilo-free') ?? DIRECT_FREE_SOURCES[0];
  const started = Date.now();
  const model = input.model ?? source.models[0];
  try {
    const res = await fetch(`${(opts.baseUrl ?? resolveBaseUrl(source)).replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: headersFor(source),
      body: JSON.stringify({
        model,
        messages: input.messages,
        max_tokens: 1024,
        stream: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        text: '',
        latencyMs: Date.now() - started,
        error: raw.slice(0, 500),
      };
    }
    const json = JSON.parse(raw) as {
      usage?: DirectChatResult['usage'];
    };
    return {
      ok: true,
      status: res.status,
      text: extractCompletionText(json),
      provider: `${source.id}:${model}`,
      latencyMs: Date.now() - started,
      usage: json.usage,
    };
  } catch (err) {
    return { ok: false, text: '', latencyMs: Date.now() - started, error: (err as Error).message };
  }
}
