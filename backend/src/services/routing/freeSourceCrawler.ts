import { upsertFreeSources, countFreeSources, listFreeSources, type FreeSource } from '../../db/repo/freeSources.js';

/**
 * 免费模型源抓取：从 dsh-our-free-model 的 provider 注册表（registry.json）抓取
 * 全部提供商，解析 category（free/apikey/oauth/local）+ format（openai-chat /
 * openai-responses / anthropic-messages）+ baseUrl + models，存入 free_sources 表。
 *
 * 这样「符合各平台协议」的免费源（codex 要 responses、claude 要 anthropic-messages、
 * 其余要 chat）都能从同一目录动态发现，供「一键配置模型」按平台协议选源。
 */

/** registry.json 抓取源（可环境变量覆盖，便于自建镜像） */
const REGISTRY_URLS = [
  process.env.FREE_SOURCE_REGISTRY_URL ??
    'https://raw.githubusercontent.com/Daixingdeng/dsh-our-free-model/main/src/providers/registry.json',
];

export interface CrawlResult {
  ok: boolean;
  source: string;
  total: number;
  saved: number;
  byFormat: Record<string, number>;
  byCategory: Record<string, number>;
  freeTier: number;
  error?: string;
}

/** 解析 registry.json 单条 provider → FreeSource（非法条目返回 null） */
export function parseProvider(p: Record<string, unknown>): FreeSource | null {
  const id = typeof p.id === 'string' ? p.id : '';
  const baseUrl = typeof p.baseUrl === 'string' ? p.baseUrl : '';
  const format = typeof p.format === 'string' ? p.format : '';
  if (!id || !baseUrl || !format) return null;
  const models = Array.isArray(p.models)
    ? p.models
        .map((m) => {
          const mm = m as Record<string, unknown>;
          return { id: typeof mm.id === 'string' ? mm.id : '', name: typeof mm.name === 'string' ? mm.name : undefined };
        })
        .filter((m) => m.id)
    : [];
  return {
    sourceId: id,
    name: typeof p.name === 'string' ? p.name : id,
    category: typeof p.category === 'string' ? p.category : 'apikey',
    format,
    baseUrl,
    models,
    notes: typeof p.notes === 'string' ? p.notes : '',
    website: typeof p.website === 'string' ? p.website : '',
  };
}

/** 抓取并落库 */
export async function crawlFreeSources(url?: string): Promise<CrawlResult> {
  const target = url ?? REGISTRY_URLS[0]!;
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return { ok: false, source: target, total: 0, saved: 0, byFormat: {}, byCategory: {}, freeTier: 0, error: `http ${res.status}` };
    }
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      return { ok: false, source: target, total: 0, saved: 0, byFormat: {}, byCategory: {}, freeTier: 0, error: 'registry 非数组' };
    }
    const sources = json
      .map((p) => parseProvider(p as Record<string, unknown>))
      .filter((s): s is FreeSource => s !== null);
    const saved = upsertFreeSources(sources);

    const byFormat: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const s of sources) {
      byFormat[s.format] = (byFormat[s.format] ?? 0) + 1;
      byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
    }
    return {
      ok: true,
      source: target,
      total: json.length,
      saved,
      byFormat,
      byCategory,
      freeTier: sources.filter((s) => s.category === 'free' || s.category === 'free-tier').length,
    };
  } catch (err) {
    return {
      ok: false,
      source: target,
      total: 0,
      saved: 0,
      byFormat: {},
      byCategory: {},
      freeTier: 0,
      error: (err as Error).message,
    };
  }
}

/** 目录统计（供 /api/free-sources 查询） */
export function freeSourcesStats(): { total: number } {
  return { total: countFreeSources() };
}

/** 按协议/分类列出源 */
export function queryFreeSources(filter: { format?: string; category?: string } = {}): FreeSource[] {
  return listFreeSources(filter);
}

/** 定时抓取循环（启动后每 N 小时抓一次） */
let crawlTimer: NodeJS.Timeout | null = null;

export function startFreeSourceCrawlLoop(intervalMs = 12 * 3600 * 1000): void {
  if (crawlTimer) return;
  const run = (): void => {
    void crawlFreeSources().then((r) => {
      console.log(`[free-sources] 定时抓取完成 ok=${r.ok} saved=${r.saved} freeTier=${r.freeTier}`);
    });
  };
  // 启动后 30s 首次抓取，之后每 intervalMs 一次
  setTimeout(run, 30_000).unref();
  crawlTimer = setInterval(run, intervalMs);
  crawlTimer.unref();
}
