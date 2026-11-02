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

/**
 * 批量翻译英文描述 → 中文（用 deepseek，DEEPSEEK_API_KEY 环境变量）。
 * 无 key / 调用失败 / 解析失败时返回空字符串数组，不阻断导入（前端回退显示英文）。
 */
async function translateBatchToZh(texts: string[]): Promise<string[]> {
  const empty = texts.map(() => '');
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return empty;
  const nonEmpty = texts.map((t) => t?.trim() || '');
  if (nonEmpty.every((t) => !t)) return empty;
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: '你是翻译助手。把下面英文技术描述逐条翻译成简洁中文，只输出 JSON 字符串数组，保持顺序和条数一致，不要输出任何其它内容。',
          },
          { role: 'user', content: JSON.stringify(nonEmpty) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return empty;
    const arr = JSON.parse(m[0]) as unknown[];
    return texts.map((_, i) => (typeof arr[i] === 'string' ? (arr[i] as string) : ''));
  } catch {
    return empty;
  }
}

/** 批量导入 GitHub 仓库为 skill 资产（source=github，去重：同名已存在则跳过） */
export async function importGithubSkills(
  repos: Array<{ fullName: string; description?: string; url?: string; topics?: string[] }>,
): Promise<{ created: Asset[]; skipped: string[] }> {
  const existing = new Set(assetService.list({ kind: 'skill' }).map((a) => a.name));
  const toImport: Array<{ fullName: string; description?: string; url?: string; topics?: string[] }> = [];
  const skipped: string[] = [];

  for (const repo of repos) {
    const fullName = repo.fullName?.trim();
    if (!fullName) continue;
    if (existing.has(fullName)) {
      skipped.push(fullName);
      continue;
    }
    toImport.push(repo);
  }

  // 批量翻译描述（失败则 descriptionZh 留空，前端回退英文）
  const zh = await translateBatchToZh(toImport.map((r) => r.description ?? ''));

  const created: Asset[] = [];
  for (let i = 0; i < toImport.length; i++) {
    const repo = toImport[i];
    const asset = assetService.create({
      kind: 'skill',
      name: repo.fullName,
      description: repo.description ?? '',
      descriptionZh: zh[i] ?? '',
      source: 'github',
      // content 存仓库地址 + 说明，作为 skill 的引用元数据
      content: JSON.stringify(
        { repo: repo.fullName, url: repo.url ?? `https://github.com/${repo.fullName}` },
        null,
        2,
      ),
      contentType: 'text',
      tags: ['github', ...(repo.topics ?? []).slice(0, 5)],
    });
    existing.add(repo.fullName);
    created.push(asset);
  }

  return { created, skipped };
}

/** 仓库内子 skill（从 SKILL.md frontmatter 解析） */
export interface RepoSkill {
  name: string;
  description: string;
  path: string;
}

/** 解析 SKILL.md 的 frontmatter 字段（name / description，兼容 YAML 块语法 > / | / |-） */
function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const name = content.match(/^name:\s*["']?([^"'\r\n]+)["']?/m)?.[1]?.trim() ?? '';
  let description = '';
  const descLine = content.match(/^description:\s*(.*)$/m)?.[1]?.trim() ?? '';
  if (descLine && !['>', '|', '|-', '>-' ].includes(descLine)) {
    description = descLine.replace(/^["']|["']$/g, '');
  } else if (['>', '|', '|-', '>-' ].includes(descLine)) {
    // YAML 块语法：取 description 后缩进的整段，折叠为单行
    const block = content.match(/^description:\s*(?:>|\||\|-|>-)\s*\r?\n([\s\S]*?)(?=\r?\n\S|\r?\n---|$)/m);
    if (block) {
      description = block[1]
        .replace(/^\s+/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return { name, description };
}

/**
 * 抓取仓库内具体子 skill（如 anthropics/skills 的每个子目录 = 一个 skill）。
 * 用 git trees API 递归获取整个文件树，找到所有 SKILL.md，解析其 frontmatter。
 */
export async function listRepoSkills(owner: string, repo: string): Promise<RepoSkill[]> {
  const token = getGithubToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agentfleet',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // 先取默认分支
  let branch = 'main';
  try {
    const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as { default_branch?: string };
      if (meta.default_branch) branch = meta.default_branch;
    }
  } catch {
    /* 用默认 main 兜底 */
  }

  // git trees 递归拿整个文件树
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers, signal: AbortSignal.timeout(20_000) },
  );
  if (!treeRes.ok) {
    throw new Error(`GitHub API ${treeRes.status}`);
  }
  const treeData = (await treeRes.json()) as {
    tree?: Array<{ path: string; type: string }>;
  };
  const skillMdPaths = (treeData.tree ?? [])
    .filter((it) => it.type === 'blob' && /SKILL\.md$/i.test(it.path))
    .slice(0, 60);

  const skills: RepoSkill[] = [];
  for (const item of skillMdPaths) {
    // 父目录 = skill 路径
    const dirPath = item.path.replace(/\/SKILL\.md$/i, '');
    try {
      const skillRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(item.path)}`,
        { headers, signal: AbortSignal.timeout(10_000) },
      );
      if (!skillRes.ok) continue;
      const skillData = (await skillRes.json()) as { content?: string };
      if (!skillData.content) continue;
      const content = Buffer.from(skillData.content, 'base64').toString('utf-8');
      const { name, description } = parseSkillFrontmatter(content);
      if (name || description) {
        skills.push({ name: name || dirPath.split('/').pop() || dirPath, description, path: dirPath });
      }
    } catch {
      /* 单个 SKILL.md 抓取失败跳过 */
    }
  }

  return skills;
}

/** 批量导入仓库内子 skill 为资产（name = `${owner}/${repo}/${path}`，去重） */
export async function importRepoSkills(
  owner: string,
  repo: string,
  skills: Array<{ name: string; description?: string; path: string }>,
): Promise<{ created: Asset[]; skipped: string[] }> {
  const prefix = `${owner}/${repo}`;
  const existing = new Set(assetService.list({ kind: 'skill' }).map((a) => a.name));
  const toImport = skills.filter((s) => {
    const fullName = `${prefix}/${s.path}`;
    return !existing.has(fullName);
  });
  const skipped = skills.filter((s) => existing.has(`${prefix}/${s.path}`)).map((s) => `${prefix}/${s.path}`);

  const zh = await translateBatchToZh(toImport.map((s) => s.description ?? ''));

  const created: Asset[] = [];
  for (let i = 0; i < toImport.length; i++) {
    const s = toImport[i];
    const fullName = `${prefix}/${s.path}`;
    const asset = assetService.create({
      kind: 'skill',
      name: fullName,
      description: s.description ?? '',
      descriptionZh: zh[i] ?? '',
      source: 'github',
      content: JSON.stringify(
        { repo: prefix, path: s.path, url: `https://github.com/${prefix}/tree/main/${s.path}` },
        null,
        2,
      ),
      contentType: 'text',
      tags: ['github', 'sub-skill'],
    });
    existing.add(fullName);
    created.push(asset);
  }

  return { created, skipped };
}
