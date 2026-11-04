import type {
  DashboardSnapshot,
  TaskSnapshot,
  DeviceSnapshot,
  AgentSnapshot,
  Team,
  RoleTeam,
  SubRole,
  SwarmRoutingDecision,
  AgentType,
  SwarmPurpose,
} from '@agentfleet/shared';

/**
 * REST 客户端（fetch 封装）。BASE_URL 可通过 VITE_API_BASE 覆盖。
 */
const BASE_URL = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:4173';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 仅在存在 body 时设置 Content-Type，避免无 body 请求触发
  // Fastify FST_ERR_CTP_EMPTY_JSON_BODY（取消/重试/删除等接口）
  const headers: Record<string, string> = {};
  if (init?.body != null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface ApiOk<T> {
  ok: boolean;
  data: T;
  error?: string;
}

/** GET 便捷封装 */
export function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** POST 便捷封装（无 body 时不设 Content-Type，避免 Fastify 空 JSON 报错） */
export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** PUT 便捷封装 */
export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** DELETE 便捷封装 */
export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

/** multipart 上传（FormData，不手动设 Content-Type，交由浏览器边界） */
export async function uploadForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export const http = {
  getHealth: () => request<{ ok: boolean }>('/api/system/health'),
  getStatus: () =>
    request<ApiOk<{ devicesOnline: number; tasksRunning: number; relayConnected: boolean }>>(
      '/api/system/status',
    ),
  getAttention: () =>
    request<ApiOk<{ needsLogin: number; pendingActions: number; alerts: number }>>(
      '/api/system/attention',
    ),
  getDevices: () => request<ApiOk<Array<DeviceSnapshot & { agents: AgentSnapshot[] }>>>('/api/devices'),
  getDevice: (id: string) =>
    request<ApiOk<DeviceSnapshot & { agents: AgentSnapshot[] }>>(`/api/devices/${id}`),
  deleteDevice: (id: string) => request<ApiOk<never>>(`/api/devices/${id}`, { method: 'DELETE' }),
  openPlatform: (deviceId: string, agentType: string) =>
    request<ApiOk<{ dispatched: boolean; deviceId: string; agentType: string }>>(
      `/api/devices/${deviceId}/platforms/${agentType}/open`,
      { method: 'POST' },
    ),
  requestDeviceLogin: (deviceId: string, agentType: string) =>
    request<ApiOk<{ dispatched: boolean; deviceId: string; agentType: string }>>(
      `/api/devices/${deviceId}/platforms/${agentType}/login`,
      { method: 'POST' },
    ),
  pairDevice: (deviceId: string, name?: string) =>
    request<ApiOk<{ pairingCode: string }>>('/api/devices/pair', {
      method: 'POST',
      body: JSON.stringify({ deviceId, name }),
    }),
  getTeams: () => request<ApiOk<Team[]>>('/api/teams'),
  setDeviceTeam: (deviceId: string, teamId: string | null) =>
    request<ApiOk<{ deviceId: string; teamId: string | null; teamName: string | null }>>(
      `/api/devices/${deviceId}/team`,
      { method: 'PUT', body: JSON.stringify({ teamId }) },
    ),
  getTasks: (query = '') => request<ApiOk<TaskSnapshot[]>>(`/api/tasks${query}`),
  getTask: (id: string) =>
    request<ApiOk<TaskSnapshot & { messages: unknown[]; sessionTitle?: string }>>(`/api/tasks/${id}`),
  createTask: (body: {
    prompt: string;
    origin?: string;
    originRef?: string;
    sessionId?: string;
    target?: {
      mode?: string;
      deviceId?: string;
      agentType?: string;
      role?: string;
      teamId?: string;
      roleTeamId?: string;
      subRole?: string;
      requireCapability?: string;
      /** 平台内的 bot 名（如 grok 自定义 agent） */
      agentProfile?: string;
    };
  }) =>
    request<ApiOk<{ taskId: string; sessionId: string; status: string }>>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelTask: (id: string) => request<ApiOk<never>>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  retryTask: (id: string) => request<ApiOk<{ taskId: string }>>(`/api/tasks/${id}/retry`, { method: 'POST' }),
  getMemorySummary: () =>
    request<{
      group: string;
      schema: string;
      blocks: number;
      changes: number;
      tipIndex: number;
      tipHash: string;
      healthy: boolean;
      error: string | null;
      updatedAt: string;
    }>('/api/memory/summary'),

  // ===== 蜂群角色团队 =====
  getSwarmTeams: () => request<ApiOk<RoleTeam[]>>('/api/swarm/teams'),
  getSwarmTeam: (id: string) =>
    request<ApiOk<RoleTeam & { subRoles: SubRole[] }>>(`/api/swarm/teams/${id}`),
  createSwarmTeam: (body: {
    name: string;
    slug?: string;
    description?: string;
    purpose?: SwarmPurpose;
    subRoles?: Array<Partial<SubRole> & { slug: string; name: string }>;
  }) => post<ApiOk<RoleTeam>>('/api/swarm/teams', body),
  updateSwarmTeam: (
    id: string,
    body: { name?: string; slug?: string; description?: string; purpose?: SwarmPurpose },
  ) => put<ApiOk<RoleTeam>>(`/api/swarm/teams/${id}`, body),
  setSwarmLeader: (id: string, slug: string | null) =>
    put<ApiOk<RoleTeam>>(`/api/swarm/teams/${id}/leader`, { slug }),
  deleteSwarmTeam: (id: string) => del<ApiOk<never>>(`/api/swarm/teams/${id}`),
  upsertSwarmSubRole: (teamId: string, body: Partial<SubRole> & { slug: string; name: string }) =>
    post<ApiOk<SubRole>>(`/api/swarm/teams/${teamId}/sub-roles`, body),
  deleteSwarmSubRole: (teamId: string, slug: string) =>
    del<ApiOk<never>>(`/api/swarm/teams/${teamId}/sub-roles/${encodeURIComponent(slug)}`),
  bindSwarmDevices: (teamId: string, deviceIds: string[]) =>
    post<ApiOk<{ changed: number; missing: string[] }>>(`/api/swarm/teams/${teamId}/devices`, { deviceIds }),
  unbindSwarmDevice: (teamId: string, deviceId: string) =>
    del<ApiOk<{ unbound: boolean }>>(`/api/swarm/teams/${teamId}/devices/${deviceId}`),
  getSwarmDeviceBindings: () =>
    request<
      ApiOk<Array<{ deviceId: string; roleTeamId: string; roleTeamName: string; purpose?: SwarmPurpose }>>
    >('/api/swarm/device-bindings'),
  getSubRoleBindings: (deviceId: string) =>
    request<ApiOk<Record<string, AgentType>>>(`/api/swarm/devices/${deviceId}/sub-role-bindings`),
  setSubRoleBinding: (deviceId: string, slug: string, agentType: AgentType | null) =>
    put<ApiOk<Record<string, AgentType>>>(`/api/swarm/devices/${deviceId}/sub-role-binding`, {
      slug,
      agentType,
    }),
  resolveSwarm: (roleTeamId: string, subRoleSlug?: string) =>
    post<ApiOk<SwarmRoutingDecision | null>>('/api/swarm/resolve', { roleTeamId, subRoleSlug }),
};

export type { DashboardSnapshot, TaskSnapshot, DeviceSnapshot, AgentSnapshot };
