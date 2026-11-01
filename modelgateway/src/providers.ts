import {
  DIRECT_FREE_SOURCES,
  resolveBaseUrl,
  type DirectFreeSource,
} from '@agentmesh/shared';
import type { PaidProviderConfig } from './config.js';

/**
 * 内置 provider 池：
 * - 直连免费源：shared DIRECT_FREE_SOURCES（Kilo / OpenCode）
 * - 可配置付费 provider：MG_PAID_PROVIDERS 环境变量或本机 .workbuddy-ai 配置（apiKey 不落仓库、不明文回显）
 *
 * resolve(model)：付费精确匹配 → 直连免费匹配 → 默认 kilo-free（置 degraded）。
 */

export type ProviderKind = 'paid' | 'direct-free';
export type ProviderAuth = 'none' | 'bearer' | 'bearer-public';

export interface ProviderConfig {
  id: string;
  label: string;
  /** OpenAI 兼容 base（含 /v1） */
  baseUrl: string;
  /** 仅 env 注入，绝不落库/落 UI */
  apiKey: string;
  models: string[];
  kind: ProviderKind;
  auth: ProviderAuth;
}

export interface ProviderResolution {
  provider: ProviderConfig;
  outModel: string;
  degraded: boolean;
}

export interface GatewayProviderStatus {
  id: string;
  label: string;
  kind: ProviderKind;
  models: string[];
  defaultModel: string;
}

function toDirectProvider(source: DirectFreeSource): ProviderConfig {
  return {
    id: source.id,
    label: source.label,
    // 走 resolveBaseUrl：支持 FREE_KILO_BASE_URL / FREE_OPENCODE_BASE_URL 环境变量覆盖（自建镜像/测试）
    baseUrl: resolveBaseUrl(source),
    apiKey: source.auth === 'bearer-public' ? 'public' : '',
    models: source.models,
    kind: 'direct-free',
    auth: source.auth === 'bearer-public' ? 'bearer-public' : 'none',
  };
}

function toPaidProvider(p: PaidProviderConfig): ProviderConfig {
  return {
    id: p.id,
    label: p.label,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    models: p.models,
    kind: 'paid',
    auth: 'bearer',
  };
}

/** 去掉 `{id}:` 或 `{id}/` 前缀，返回真实模型名 */
function stripPrefix(model: string, id: string): string {
  for (const sep of [':', '/']) {
    const prefix = `${id}${sep}`;
    if (model.startsWith(prefix)) return model.slice(prefix.length);
  }
  return model;
}

export class ProviderPool {
  private providers: ProviderConfig[];

  constructor(paidProviders: PaidProviderConfig[] = []) {
    const direct = DIRECT_FREE_SOURCES.map(toDirectProvider);
    const paid = paidProviders.map(toPaidProvider);
    this.providers = [...paid, ...direct];
  }

  list(): ProviderConfig[] {
    return this.providers;
  }

  resolve(model: string): ProviderResolution {
    const m = model.trim();
    // 付费精确匹配（含 `id:model` / `id/model` 前缀写法）
    for (const p of this.providers) {
      if (p.kind !== 'paid') continue;
      if (p.models.includes(m) || m.startsWith(`${p.id}:`) || m.startsWith(`${p.id}/`)) {
        return { provider: p, outModel: stripPrefix(m, p.id), degraded: false };
      }
    }
    // 直连免费匹配
    for (const p of this.providers) {
      if (p.kind !== 'direct-free') continue;
      if (p.models.includes(m) || m.startsWith(`${p.id}:`) || m.startsWith(`${p.id}/`)) {
        return { provider: p, outModel: stripPrefix(m, p.id), degraded: false };
      }
    }
    // 默认降级到 kilo-free
    const fallback = this.providers.find((p) => p.id === 'kilo-free') ?? this.providers[0];
    if (!fallback) {
      throw new Error('no provider configured');
    }
    return { provider: fallback, outModel: m, degraded: true };
  }

  /** 健康汇总（供 /health 与 /v1/models） */
  health(): GatewayProviderStatus[] {
    return this.providers.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      models: p.models,
      defaultModel: p.models[0] ?? '',
    }));
  }

  /** 聚合可用模型 id（/v1/models） */
  allModels(): string[] {
    const seen = new Set<string>();
    for (const p of this.providers) {
      for (const m of p.models) seen.add(m);
    }
    return Array.from(seen);
  }

  defaultModel(): string {
    return this.providers[0]?.models[0] ?? 'kilo-auto/free';
  }
}
