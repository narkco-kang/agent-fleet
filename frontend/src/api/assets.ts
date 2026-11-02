import type {
  Asset,
  AssetContentType,
  AssetDelivery,
  AssetKind,
} from '@agentmesh/shared';
import { del, get, post, put, uploadForm, type ApiOk } from './http';

/**
 * 资产管理 API：规则 / 资料库 / skills 统一 CRUD + 分发（人工确认）。
 */

/** 分发请求结果（POST /api/assets/deliver 返回，未确认前不产生任何下发） */
export interface DeliveryRequestResult {
  deliveryId: string;
  status: 'pending_confirmation';
  confirmationId: string;
  assetCount: number;
  targetCount: number;
  summary: string;
}

/** 构造查询串（忽略空值） */
function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const assetsApi = {
  /** 资产列表（可按 kind 过滤） */
  list: (kind?: AssetKind) =>
    get<ApiOk<Asset[]>>(`/api/assets${kind ? `?kind=${kind}` : ''}`),

  /** 资产详情 */
  get: (id: string) => get<ApiOk<Asset>>(`/api/assets/${id}`),

  /** 创建资产 */
  create: (body: {
    kind: AssetKind;
    name: string;
    content: string;
    contentType?: AssetContentType;
    tags?: string[];
  }) => post<ApiOk<Asset>>('/api/assets', body),

  /** 创建二进制资产（skills 包等文件，multipart 上传，后端存 base64 + contentType=file） */
  createFile: (kind: AssetKind, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    form.append('name', file.name);
    return uploadForm<ApiOk<Asset>>('/api/assets', form);
  },

  /** 更新资产（version 递增） */
  update: (
    id: string,
    patch: { name?: string; content?: string; contentType?: AssetContentType; tags?: string[] },
  ) => put<ApiOk<Asset>>(`/api/assets/${id}`, patch),

  /** 删除资产 */
  remove: (id: string) => del<ApiOk<never>>(`/api/assets/${id}`),

  /** 请求分发（生成人工确认，未确认前不落盘/不下发） */
  deliver: (assetIds: string[], targets: string[]) =>
    post<ApiOk<DeliveryRequestResult>>('/api/assets/deliver', { assetIds, targets }),

  /** 确认执行分发（id = deliveryId） */
  confirmDelivery: (deliveryId: string) =>
    post<ApiOk<unknown>>(`/api/assets/deliver/${deliveryId}/confirm`),

  /** 分发记录列表 */
  listDeliveries: (filter?: { status?: string; deviceId?: string }) =>
    get<ApiOk<AssetDelivery[]>>(
      `/api/assets/deliveries${buildQuery({ status: filter?.status, deviceId: filter?.deviceId })}`,
    ),
};

export type { Asset, AssetContentType, AssetDelivery, AssetKind };
