import type {
  DashboardSnapshot,
  TaskSnapshot,
  DeviceSnapshot,
  AgentSnapshot,
  Team,
} from '@agentmesh/shared';

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
  getDevices: () => request<ApiOk<Array<DeviceSnapshot & { agents: AgentSnapshot[] }>>>('/api/devices'),
  getDevice: (id: string) =>
    request<ApiOk<DeviceSnapshot & { agents: AgentSnapshot[] }>>(`/api/devices/${id}`),
  deleteDevice: (id: string) => request<ApiOk<never>>(`/api/devices/${id}`, { method: 'DELETE' }),
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
      requireCapability?: string;
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
};

export type { DashboardSnapshot, TaskSnapshot, DeviceSnapshot, AgentSnapshot };
