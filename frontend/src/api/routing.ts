import type {
  AgentType,
  DirectFreeSource,
  DirectProbeResult,
  PlatformModelBinding,
  RoleRoute,
  RoleRoutingDecision,
} from '@agentfleet/shared';
import { del, get, post, type ApiOk } from './http';

/**
 * 路由网关 + 平台模型 + 免费源 + 台账 API。
 */
export interface UsageSummary {
  totalRecords: number;
  totalTokensIn: number;
  totalTokensOut: number;
  byProvider: Record<string, { tokensIn: number; tokensOut: number; records: number }>;
  byModel: Record<string, { tokensIn: number; tokensOut: number; records: number }>;
}

export interface UsageRecordRow {
  record_id: string;
  task_id: string | null;
  provider: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: number;
}

export interface FreeSourceRankedItem {
  key: string;
  kind: 'gateway' | 'direct';
  label: string;
  rating: 'excellent' | 'medium' | 'poor';
  ratingLabel: string;
  latencyMs: number;
  quotaLimited?: boolean;
}

export interface AllFreeSourcesReport {
  gateway: {
    configured: boolean;
    sources: string[];
    summary: { total: number; ok: number; failed: number; checkinAttempted: number; checkinOk: number };
    results: Array<{
      model: string;
      ok: boolean;
      latencyMs: number;
      rating: 'excellent' | 'medium' | 'poor';
      error?: string;
    }>;
  };
  direct: DirectProbeResult[];
  usable: string[];
  ranked: FreeSourceRankedItem[];
  directCatalog: Array<{ id: string; label: string; models: string[]; note: string }>;
}

export interface CheckinResult {
  sourceId: string;
  name: string;
  ok: boolean;
  detail: string;
}

export const routingApi = {
  roles: () => get<ApiOk<RoleRoute[]>>('/api/routing/roles'),
  saveRole: (role: RoleRoute) => post<ApiOk<RoleRoute>>('/api/routing/roles', role),
  importRoles: (json: string) => post<ApiOk<{ imported: number }>>('/api/routing/roles/import', { json }),
  deleteRole: (role: string) => del<ApiOk<never>>(`/api/routing/roles/${encodeURIComponent(role)}`),
  decide: (role: string, preferLocal?: boolean) =>
    post<ApiOk<RoleRoutingDecision>>('/api/routing/decide', { role, preferLocal }),

  usageSummary: () => get<ApiOk<UsageSummary>>('/api/routing/usage'),
  usageRecords: () => get<ApiOk<UsageRecordRow[]>>('/api/routing/usage/records'),
  gatewayHealth: () =>
    get<ApiOk<{ configured: boolean; available: boolean; healthy: boolean }>>('/api/routing/gateway/health'),

  freeSources: () => get<ApiOk<{ sources: string[] }>>('/api/routing/free-sources'),
  freeSourceCatalog: () => get<ApiOk<DirectFreeSource[]>>('/api/routing/free-sources/catalog'),
  probeDirect: (sourceId: string, model?: string) =>
    post<ApiOk<DirectProbeResult>>('/api/routing/free-sources/probe-direct', { sourceId, model }),
  probeAll: (opts?: { autoCheckin?: boolean; timeoutMs?: number }) =>
    post<ApiOk<AllFreeSourcesReport>>('/api/routing/free-sources/probe-all', opts ?? {}),
  checkin: (sourceId?: string) =>
    post<ApiOk<CheckinResult[]>>('/api/routing/free-sources/checkin', sourceId ? { sourceId } : {}),
  checkinStatus: () =>
    get<ApiOk<{ sources: Array<{ id: string; name: string; kind: string; enabled: boolean; note: string; last?: { status?: string; detail?: string; checked_at?: number } | null }>; records: unknown[] }>>(
      '/api/routing/free-sources/checkin/status',
    ),

  platformModels: () => get<ApiOk<PlatformModelBinding[]>>('/api/routing/platform-models'),
  bindPlatformModel: (deviceId: string, agentType: AgentType, model: string, fallbacks?: string[]) =>
    post<ApiOk<PlatformModelBinding>>('/api/routing/platform-models', { deviceId, agentType, model, fallbacks }),
  unbindPlatformModel: (deviceId: string, agentType: AgentType) =>
    del<ApiOk<{ removed: number }>>(`/api/routing/platform-models/${deviceId}/${agentType}`),
  switchPlatformModel: (deviceId: string, agentType: AgentType, model: string) =>
    post<ApiOk<PlatformModelBinding>>(`/api/routing/platform-models/${deviceId}/${agentType}/switch`, { model }),
  resetPlatformModel: (deviceId: string, agentType: AgentType) =>
    post<ApiOk<PlatformModelBinding>>(`/api/routing/platform-models/${deviceId}/${agentType}/reset`),
};
