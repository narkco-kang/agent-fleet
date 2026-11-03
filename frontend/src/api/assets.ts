import type {
  Asset,
  AssetContentType,
  AssetDelivery,
  AssetKind,
  AssetSource,
} from '@agentfleet/shared';
import { del, get, post, put, uploadForm, type ApiOk } from './http';

/**
 * 资产管理 API：规则 / 资料库 / skills 统一 CRUD + 分发（人工确认）+ GitHub skills 目录。
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

/** GitHub skills 仓库搜索结果 */
export interface GithubSkillRepo {
  fullName: string;
  name: string;
  description: string;
  stars: number;
  url: string;
  language: string;
  topics: string[];
}

/** 仓库内子 skill（从 SKILL.md 解析） */
export interface RepoSkill {
  name: string;
  description: string;
  path: string;
}

/** GitHub 提示词仓库搜索结果 */
export interface GithubPromptRepo {
  fullName: string;
  name: string;
  description: string;
  stars: number;
  url: string;
}

/** 仓库内具体提示词条目 */
export interface RepoPrompt {
  name: string;
  content: string;
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
    description?: string;
    source?: AssetSource;
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

  /** 批量上传多文件（skills/规则批量导入，每个文件一个资产） */
  batchUpload: (kind: AssetKind, files: File[], description?: string) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    form.append('kind', kind);
    if (description) form.append('description', description);
    return uploadForm<ApiOk<{ created: Asset[]; count: number }>>('/api/assets/batch', form);
  },

  /** 更新资产（version 递增） */
  update: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      source?: AssetSource;
      content?: string;
      contentType?: AssetContentType;
      tags?: string[];
    },
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

  // ===== Skills 目录（GitHub 抓取 + 导入）=====

  /** 实时抓取 GitHub 最多星 skills 仓库 */
  searchGithubSkills: (query?: string, limit = 20) =>
    get<ApiOk<GithubSkillRepo[]>>(
      `/api/skills/github${buildQuery({ query, limit: String(limit) })}`,
    ),

  /** 批量导入 GitHub 仓库为 skill 资产 */
  importGithubSkills: (repos: Array<{ fullName: string; description?: string; url?: string; topics?: string[] }>) =>
    post<ApiOk<{ created: Asset[]; skipped: string[] }>>('/api/skills/import', { repos }),

  /** 列出仓库内具体子 skill（解析 SKILL.md） */
  listRepoSkills: (owner: string, repo: string) =>
    get<ApiOk<RepoSkill[]>>(`/api/skills/repo/${owner}/${repo}`),

  /** 批量导入仓库内子 skill */
  importRepoSkills: (
    owner: string,
    repo: string,
    skills: Array<{ name: string; description?: string; path: string }>,
  ) => post<ApiOk<{ created: Asset[]; skipped: string[] }>>('/api/skills/repo/import', { owner, repo, skills }),

  // ===== 提示词库（GitHub 抓取 + 导入）=====

  /** 实时抓取 GitHub 最多星提示词仓库 */
  searchGithubPrompts: (query?: string, limit = 20) =>
    get<ApiOk<GithubPromptRepo[]>>(
      `/api/prompts/github${buildQuery({ query, limit: String(limit) })}`,
    ),

  /** 列出仓库内具体提示词（解析 prompts.csv / PROMPTS.md） */
  listRepoPrompts: (owner: string, repo: string) =>
    get<ApiOk<RepoPrompt[]>>(`/api/prompts/repo/${owner}/${repo}`),

  /** 批量导入仓库内提示词为 prompt 资产 */
  importRepoPrompts: (
    owner: string,
    repo: string,
    prompts: Array<{ name: string; content: string }>,
  ) => post<ApiOk<{ created: Asset[]; skipped: string[] }>>('/api/prompts/repo/import', { owner, repo, prompts }),
};

export type { Asset, AssetContentType, AssetDelivery, AssetKind };
