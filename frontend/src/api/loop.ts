import { del, get, post, type ApiOk } from './http';

/**
 * Loop 编排 API（P2-10 编排可视化）。
 */
export interface LoopStep {
  id: string;
  name: string;
  template: { prompt: string; target: { mode?: string; deviceId?: string; agentType?: string; role?: string }; options: Record<string, unknown> };
  dependsOn: string[];
  operator?: 'sequence' | 'parallel' | 'map' | 'human';
}

export interface Loop {
  id: string;
  name: string;
  steps: LoopStep[];
  trigger: string;
  targets: string[];
  state: string;
  currentRound: number;
  currentStepIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface LoopGraphNode {
  id: string;
  name: string;
  operator: string;
  status: string;
  human: boolean;
  taskIds: string[];
}

export interface LoopGraph {
  loopId: string;
  state: string;
  currentRound: number;
  nodes: LoopGraphNode[];
  edges: Array<{ from: string; to: string }>;
}

export const loopApi = {
  list: () => get<ApiOk<Loop[]>>('/api/loops'),
  get: (id: string) => get<ApiOk<Loop>>(`/api/loops/${id}`),
  graph: (id: string) => get<ApiOk<LoopGraph>>(`/api/loops/${id}/graph`),
  create: (body: { name: string; steps?: LoopStep[]; trigger?: string; targets?: string[] }) =>
    post<ApiOk<Loop>>('/api/loops', body),
  start: (id: string) => post<ApiOk<{ loopId: string; confirmationId: string; status: string }>>(`/api/loops/${id}/start`),
  confirm: (id: string) => post<ApiOk<unknown>>(`/api/loops/${id}/confirm`),
  pause: (id: string) => post<ApiOk<unknown>>(`/api/loops/${id}/pause`),
  resume: (id: string) => post<ApiOk<unknown>>(`/api/loops/${id}/resume`),
  cancel: (id: string) => post<ApiOk<unknown>>(`/api/loops/${id}/cancel`),
  resolveStep: (id: string, stepId: string) => post<ApiOk<unknown>>(`/api/loops/${id}/steps/${stepId}/resolve`),
  remove: (id: string) => del<ApiOk<unknown>>(`/api/loops/${id}`),
};
