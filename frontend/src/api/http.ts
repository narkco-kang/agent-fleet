import type { DashboardSnapshot, TaskSnapshot, DeviceSnapshot, AgentSnapshot } from '@agentmesh/shared';

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
  getTasks: (query = '') => request<ApiOk<TaskSnapshot[]>>(`/api/tasks${query}`),
  getTask: (id: string) =>
    request<ApiOk<TaskSnapshot & { messages: unknown[]; sessionTitle?: string }>>(`/api/tasks/${id}`),
  createTask: (body: {
    prompt: string;
    origin?: string;
    originRef?: string;
    sessionId?: string;
    target?: { mode?: string; deviceId?: string; agentType?: string; requireCapability?: string };
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
