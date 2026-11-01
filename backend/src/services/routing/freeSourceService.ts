import type { RoleRoute } from '@agentmesh/shared';
import { roleRouteStore } from './roleRouteStore.js';
import { modelGatewayClient, type ModelProbeResult } from './modelGatewayClient.js';
import {
  DIRECT_FREE_SOURCES,
  keepRating,
  probeAllDirectSources,
  RATING_LABEL,
  type DirectProbeResult,
  type FreeSourceRating,
} from '@agentmesh/shared';

/** 免费源判定：role 名称或模型 ref 含 free/kilo-auto/free 等免费层特征 */
export function isFreeSourceRef(ref: string): boolean {
  const s = ref.toLowerCase();
  return s.includes('free') || s.includes('免费') || s.includes('kilo-auto/free');
}

export interface FreeSourceProbeSummary {
  total: number;
  ok: number;
  failed: number;
  checkinAttempted: number;
  checkinOk: number;
}

export interface FreeSourceProbeReport {
  configured: boolean;
  sources: string[];
  summary: FreeSourceProbeSummary;
  results: ModelProbeResult[];
}

/** 从角色路由表收集免费源模型 ref（primary/model/fallback 全覆盖，去重） */
export function collectFreeSourceRefs(routes: RoleRoute[] = roleRouteStore.list()): string[] {
  const refs: string[] = [];
  for (const route of routes) {
    const candidates = [route.model, route.primary, ...route.fallback].filter((x): x is string => Boolean(x));
    const routeLooksFree = route.role.toLowerCase().includes('free') || candidates.some(isFreeSourceRef);
    if (!routeLooksFree) continue;
    refs.push(...candidates.filter(isFreeSourceRef));
  }
  return Array.from(new Set(refs));
}

/** 真实探测免费源：发起最小 chat 请求，必要时自动签到/打卡后重试 */
export async function probeFreeSources(opts: { autoCheckin?: boolean; timeoutMs?: number } = {}): Promise<FreeSourceProbeReport> {
  const sources = collectFreeSourceRefs();
  const results = await modelGatewayClient.probeModels(sources, {
    autoCheckin: opts.autoCheckin !== false,
    timeoutMs: opts.timeoutMs,
    prompt: 'ping',
  });
  return {
    configured: modelGatewayClient.isConfigured(),
    sources,
    summary: summarize(results),
    results,
  };
}

/** 综合报告：modelgateway 免费线路 + 直连公开免费源 */
export interface AllFreeSourcesReport {
  gateway: FreeSourceProbeReport;
  direct: DirectProbeResult[];
  /** 可用源标识，如 'kilo-free:kilo-auto/free' */
  usable: string[];
  /** 评级后的保留清单（仅优/中，优在前） */
  ranked: Array<{
    key: string;
    kind: 'gateway' | 'direct';
    label: string;
    rating: FreeSourceRating;
    ratingLabel: string;
    latencyMs: number;
    quotaLimited?: boolean;
  }>;
  directCatalog: Array<{ id: string; label: string; models: string[]; note: string }>;
}

/** 真实探测所有免费源（网关 + 直连） */
export async function probeAllFreeSources(
  opts: { autoCheckin?: boolean; timeoutMs?: number } = {},
): Promise<AllFreeSourcesReport> {
  const [gateway, direct] = await Promise.all([
    probeFreeSources(opts),
    probeAllDirectSources({ timeoutMs: opts.timeoutMs }),
  ]);
  const usable = [
    ...gateway.results.filter((r) => r.ok).map((r) => `gateway:${r.model}`),
    ...direct.filter((r) => r.ok).map((r) => `${r.sourceId}:${r.model}`),
  ];

  // 评级：仅保留优/中，优在前
  const ranked = [
    ...gateway.results.map((r) => ({
      key: `gateway:${r.model}`,
      kind: 'gateway' as const,
      label: `网关 ${r.model}`,
      rating: r.rating,
      ratingLabel: RATING_LABEL[r.rating],
      latencyMs: r.latencyMs,
    })),
    ...direct.map((r) => ({
      key: `${r.sourceId}:${r.model}`,
      kind: 'direct' as const,
      label: `${r.label} ${r.model}`,
      rating: r.rating,
      ratingLabel: RATING_LABEL[r.rating],
      latencyMs: r.latencyMs,
      quotaLimited: r.quotaLimited,
    })),
  ]
    .filter((r) => keepRating(r.rating))
    .sort((a, b) => {
      const rank = { excellent: 0, medium: 1, poor: 2 } as const;
      if (rank[a.rating] !== rank[b.rating]) return rank[a.rating] - rank[b.rating];
      return a.latencyMs - b.latencyMs;
    });

  return {
    gateway,
    direct,
    usable,
    ranked,
    directCatalog: DIRECT_FREE_SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      models: s.models,
      note: s.note,
    })),
  };
}

function summarize(results: ModelProbeResult[]): FreeSourceProbeSummary {
  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    checkinAttempted: results.filter((r) => r.checkinAttempted).length,
    checkinOk: results.filter((r) => r.checkinOk).length,
  };
}
