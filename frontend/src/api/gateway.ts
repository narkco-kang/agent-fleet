import { get, post, type ApiOk } from './http';

/**
 * 协调器组件（内置 modelgateway）生命周期 API。
 */
export type GatewayComponentState = 'stopped' | 'building' | 'starting' | 'running' | 'failed';

export interface GatewayComponentStatus {
  state: GatewayComponentState;
  pid: number | null;
  built: boolean;
  healthy: boolean;
  providerCount: number;
  version: string;
  lastError: string | null;
}

export interface PaidProviderInput {
  id: string;
  label?: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface PublicPaidProvider {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  maskedApiKey: string;
  updatedAt: number;
}

export interface PaidProviderConfigStatus {
  path: string;
  providers: PublicPaidProvider[];
  reloadRequired: boolean;
  note: string;
}

export const gatewayApi = {
  status: () => get<ApiOk<GatewayComponentStatus>>('/api/gateway/component/status'),
  build: () => post<ApiOk<GatewayComponentStatus>>('/api/gateway/component/build'),
  start: () => post<ApiOk<GatewayComponentStatus>>('/api/gateway/component/start'),
  stop: () => post<ApiOk<GatewayComponentStatus>>('/api/gateway/component/stop'),
  health: () => get<ApiOk<GatewayComponentStatus>>('/api/gateway/component/health'),
  providers: () => get<ApiOk<PaidProviderConfigStatus>>('/api/gateway/providers'),
  saveProviders: (providers: PaidProviderInput[]) =>
    post<ApiOk<PaidProviderConfigStatus>>('/api/gateway/providers', { providers }),
};
