import type { DeploymentBatch, DeploymentKind, DeploymentTarget } from '@agentmesh/shared';
import { get, post, uploadForm, type ApiOk } from './http';

/**
 * 批量部署（13 平台 SSH）API：上传 Excel → 解析 → 确认 → 执行。
 */
export interface CreateBatchResult {
  batchId: string;
  status: string;
  confirmationId: string;
  targets: DeploymentTarget[];
  invalidRows: Array<{ row: number; reason: string }>;
  summary: string;
}

/** 平台目录条目（对应后端 listPlatformCatalog） */
export interface PlatformCatalogItem {
  platform: string;
  displayName: string;
  commandNames: string[];
  npmPackage?: string;
  pipxPackage?: string;
  brewCask?: string;
  wingetId?: string;
  manualReason?: string;
}

/** 单台目标机的 OS + 已装平台探测结果 */
export interface ProbeResult {
  os: string;
  installed: string[];
  missing: string[];
  results: Array<{ platform: string; installed: boolean }>;
}

export const deployApi = {
  list: (kind?: DeploymentKind) =>
    get<ApiOk<DeploymentBatch[]>>(`/api/deploy/batches${kind ? `?kind=${kind}` : ''}`),
  get: (id: string) => get<ApiOk<DeploymentBatch>>(`/api/deploy/batches/${id}`),
  createExcel: (file: File, name: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    return uploadForm<ApiOk<CreateBatchResult>>('/api/deploy/batches', form);
  },
  createUninstallExcel: (file: File, name: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    return uploadForm<ApiOk<CreateBatchResult>>('/api/deploy/uninstall-batches', form);
  },
  createFromTargets: (name: string, targets: unknown[], kind: DeploymentKind = 'deploy') =>
    post<ApiOk<CreateBatchResult>>(
      kind === 'uninstall' ? '/api/deploy/uninstall-batches' : '/api/deploy/batches',
      { name, targets },
    ),
  listPlatforms: () => get<ApiOk<PlatformCatalogItem[]>>('/api/deploy/platforms'),
  probeTarget: (body: { ip: string; user: string; password?: string; port?: number }) =>
    post<ApiOk<ProbeResult>>('/api/deploy/probe', body),
  confirm: (id: string) => post<ApiOk<unknown>>(`/api/deploy/batches/${id}/confirm`),
  cancel: (id: string) => post<ApiOk<never>>(`/api/deploy/batches/${id}/cancel`),
};
