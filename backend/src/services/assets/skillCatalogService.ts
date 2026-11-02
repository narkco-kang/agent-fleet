import { execFileSync } from 'node:child_process';
import type { Asset } from '@agentfleet/shared';
import * as assetService from './assetService.js';

/**
 * Skills 目录服务：实时抓取 GitHub 最多星的 skills 仓库 + 批量导入为 skill 资产。
 *
 * 抓取走 GitHub Search API（repositories，sort=stars），认证优先 GITHUB_TOKEN 环境变量，
 * 其次复用本机 `gh auth token`（用户已登录 gh CLI）。
 */

/** GitHub 仓库搜索结果（精简） */
export interface GithubSkillRepo {
  fullName: string;
  name: string;
  description: string;
  stars: number;
  url: string;
  language: string;
  topics: string[];
}

/** 获取 GitHub token：GITHUB_TOKEN 优先，其次 gh auth token */
function getGithubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const t = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
    return t || null;
  } catch {
    return null;
  }
}

/** 默认搜索 query：几个高价值 skill 集合关键词 */
const DEFAULT_QUERIES = [
  'claude skills',
  'agent skills',
  'anthropic skills',
  'cursor rules',
];

/**
 * 实时抓取 GitHub 最多星的 skills 仓库。
 * @param query 搜索关键词（缺省依次尝试多个默认关键词并合并去重）
 * @param limit 每个 query 的返回上限
 */
export async function searchGithubSkills(query?: string, limit = 20): Promise<GithubSkillRepo[]> {
  const token = getGithubToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agentfleet',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const queries = query?.trim() ? [query.trim()] : DEFAULT_QUERIES;
  const seen = new Set<string>();
  const out: GithubSkillRepo[] = [];

  for (const q of queries) {
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
      `&sort=stars&order=desc&per_page=${Math.min(Math.max(limit, 1), 50)}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        // 未认证时可能触发 403 限流，继续尝试下一个 query
        if (res.status === 403 || res.status === 401) continue;
        throw new Error(`GitHub API ${res.status}`);
      }
      const data = (await res.json()) as {
        items?: Array<{
          full_name: string;
          name: string;
          description: string | null;
          stargazers_count: number;
          html_url: string;
          language: string | null;
          topics: string[];
        }>;
      };
      for (const it of data.items ?? []) {
        if (seen.has(it.full_name)) continue;
        // 轻量相关性过滤：基于 name + description 含 skill 关键词（忽略宽泛的 topics 标签，
        // 因为 dify 等项目也打了 "skills"/"claude" 标签）。仅对默认 query 生效，自定义 query 不过滤。
        if (!query?.trim()) {
          const haystack = `${it.name} ${it.description ?? ''}`;
          if (!/skill/i.test(haystack)) continue;
        }
        seen.add(it.full_name);
        out.push({
          fullName: it.full_name,
          name: it.name,
          description: it.description ?? '',
          stars: it.stargazers_count ?? 0,
          url: it.html_url,
          language: it.language ?? '',
          topics: it.topics ?? [],
        });
      }
    } catch {
      /* 单个 query 失败不阻断整体 */
    }
  }

  return out.sort((a, b) => b.stars - a.stars);
}

/** 批量导入 GitHub 仓库为 skill 资产（source=github，去重：同名已存在则跳过） */
export function importGithubSkills(
  repos: Array<{ fullName: string; description?: string; url?: string; topics?: string[] }>,
): { created: Asset[]; skipped: string[] } {
  const existing = new Set(assetService.list({ kind: 'skill' }).map((a) => a.name));
  const created: Asset[] = [];
  const skipped: string[] = [];

  for (const repo of repos) {
    const fullName = repo.fullName?.trim();
    if (!fullName) continue;
    if (existing.has(fullName)) {
      skipped.push(fullName);
      continue;
    }
    const asset = assetService.create({
      kind: 'skill',
      name: fullName,
      description: repo.description ?? '',
      source: 'github',
      // content 存仓库地址 + 说明，作为 skill 的引用元数据
      content: JSON.stringify(
        { repo: fullName, url: repo.url ?? `https://github.com/${fullName}` },
        null,
        2,
      ),
      contentType: 'text',
      tags: ['github', ...(repo.topics ?? []).slice(0, 5)],
    });
    existing.add(fullName);
    created.push(asset);
  }

  return { created, skipped };
}
