import type { Asset } from '@agentfleet/shared';
import * as assetService from './assetService.js';
import { getGithubToken, translateBatchToZh } from './skillCatalogService.js';

/**
 * 提示词库（Prompt Catalog）服务：实时抓取 GitHub 上订阅/星最多的提示词集合仓库，
 * 解析仓库内的具体提示词条目（act + prompt），批量导入为 prompt 资产（含中英文注释）。
 *
 * 与 skills 库的差异：skills 抓的是「仓库」或「仓库内 SKILL.md」；提示词抓的是
 * 「仓库内的提示词条目」（如 awesome-chatgpt-prompts 的 prompts.csv 每一行 = 一个提示词）。
 */

/** GitHub 提示词仓库搜索结果（精简） */
export interface GithubPromptRepo {
  fullName: string;
  name: string;
  description: string;
  stars: number;
  url: string;
}

/** 仓库内具体提示词条目 */
export interface RepoPrompt {
  /** 提示词名称/角色（如 "Linux Terminal"） */
  name: string;
  /** 提示词内容 */
  content: string;
}

/** 默认搜索 query：高价值提示词集合关键词 */
const DEFAULT_QUERIES = [
  'chatgpt prompts',
  'claude prompts',
  'prompt engineering',
  'awesome prompts',
];

/** 抓取 GitHub 最多星提示词仓库（复用 skills 库的搜索模式） */
export async function searchGithubPromptRepos(
  query?: string,
  limit = 20,
): Promise<GithubPromptRepo[]> {
  const token = getGithubToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agentfleet',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const queries = query?.trim() ? [query.trim()] : DEFAULT_QUERIES;
  const seen = new Set<string>();
  const out: GithubPromptRepo[] = [];

  for (const q of queries) {
    const url =
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
      `&sort=stars&order=desc&per_page=${Math.min(Math.max(limit, 1), 50)}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
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
        }>;
      };
      for (const it of data.items ?? []) {
        if (seen.has(it.full_name)) continue;
        // 相关性过滤：默认 query 时要求 name+description 含 prompt 关键词
        if (!query?.trim()) {
          const haystack = `${it.name} ${it.description ?? ''}`;
          if (!/prompt/i.test(haystack)) continue;
        }
        seen.add(it.full_name);
        out.push({
          fullName: it.full_name,
          name: it.name,
          description: it.description ?? '',
          stars: it.stargazers_count ?? 0,
          url: it.html_url,
        });
      }
    } catch {
      /* 单个 query 失败不阻断整体 */
    }
  }
  return out.sort((a, b) => b.stars - a.stars);
}

/**
 * 极简 CSV 解析（处理双引号包裹 + 引号内逗号/换行），返回二维数组。
 * 用于解析 awesome-chatgpt-prompts 的 prompts.csv（"act","prompt" 两列）。
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else if (c !== '\r') {
        field += c;
      }
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

/**
 * 从 markdown 文本解析提示词列表（fallback，当仓库无 prompts.csv 时）。
 * 优先识别 <details> 块格式（f/prompts.chat 的 PROMPTS.md）：
 *   <details><summary><strong>名称</strong></summary> ... ```md 内容 ``` </details>
 * 其次识别「## 标题 + 描述段」章节格式（awesome-claude-prompts 风格）。
 */
function parsePromptsFromMarkdown(text: string): RepoPrompt[] {
  const out: RepoPrompt[] = [];

  // 1. <details> 块：<summary><strong>名称</strong></summary> + ```md 内容 ```
  const detailsRe =
    /<details>\s*<summary>\s*<strong>([^<]+)<\/strong>\s*<\/summary>[\s\S]*?```(?:md|markdown|text)?\s*\r?\n([\s\S]*?)\n?```/gi;
  for (const m of text.matchAll(detailsRe)) {
    const name = m[1]!.trim();
    const content = m[2]!.trim();
    if (name && content && content.length > 15) {
      out.push({ name, content });
    }
  }
  if (out.length > 0) return out.slice(0, 300);

  // 2. 章节格式：## 标题 + 紧随描述段
  const sectionRe = /^#{2,3}\s*(.+)$/gm;
  const sections: Array<{ title: string; body: string }> = [];
  let lastIndex = 0;
  let lastTitle = '';
  for (const m of text.matchAll(sectionRe)) {
    if (lastTitle) {
      sections.push({ title: lastTitle, body: text.slice(lastIndex, m.index ?? 0) });
    }
    lastTitle = m[1]!.trim();
    lastIndex = (m.index ?? 0) + m[0].length;
  }
  if (lastTitle) sections.push({ title: lastTitle, body: text.slice(lastIndex) });

  for (const s of sections) {
    const cleanTitle = s.title.replace(/^Act as (an? )?/i, '').trim();
    const body = s.body.trim().slice(0, 2000);
    if (!body || !/prompt|you|act|i want|respond|behave/i.test(cleanTitle + ' ' + body)) continue;
    out.push({ name: cleanTitle || s.title, content: body });
  }
  return out.slice(0, 300);
}

/** 抓取仓库内具体提示词（优先 prompts.csv，fallback README.md） */
export async function listRepoPrompts(owner: string, repo: string): Promise<RepoPrompt[]> {
  const token = getGithubToken();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agentfleet',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // 先拿默认分支（大文件需走 raw 端点，contents API 对 >1MB 文件不返回内容）
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
    /* 用 main 兜底 */
  }

  // 用 raw 端点抓文件内容（无 1MB 限制；prompts.csv / PROMPTS.md 常达数 MB）
  const fetchFile = async (path: string): Promise<string | null> => {
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) return null;
    return await res.text();
  };

  // 1. 优先 prompts.csv（老版 awesome-chatgpt-prompts 格式）
  const csv = await fetchFile('prompts.csv');
  if (csv) {
    const rows = parseCsv(csv);
    const prompts: RepoPrompt[] = [];
    for (const row of rows.slice(1)) {
      // 跳过表头（act,prompt）
      const act = row[0]?.trim() ?? '';
      const content = row[1]?.trim() ?? '';
      if (act && content && act.toLowerCase() !== 'act') {
        prompts.push({ name: act, content });
      }
    }
    if (prompts.length > 0) return prompts.slice(0, 300);
  }

  // 2. PROMPTS.md（f/prompts.chat 新格式：<details> + ```md 内容 ```）
  const promptsMd = await fetchFile('PROMPTS.md');
  if (promptsMd) {
    const prompts = parsePromptsFromMarkdown(promptsMd);
    if (prompts.length > 0) return prompts.slice(0, 300);
  }

  // 3. fallback README.md / prompts.md（markdown 解析）
  const readme = (await fetchFile('README.md')) ?? (await fetchFile('prompts.md'));
  if (readme) {
    const prompts = parsePromptsFromMarkdown(readme);
    if (prompts.length > 0) return prompts.slice(0, 300);
  }

  return [];
}

/** 批量导入仓库内提示词为 prompt 资产（name=act，content=prompt，含中英文注释） */
export async function importRepoPrompts(
  owner: string,
  repo: string,
  prompts: Array<{ name: string; content: string }>,
): Promise<{ created: Asset[]; skipped: string[] }> {
  const prefix = `${owner}/${repo}`;
  const existing = new Set(assetService.list({ kind: 'prompt' }).map((a) => a.name));
  const toImport = prompts.filter((p) => {
    const fullName = `${prefix}/${p.name}`;
    return !existing.has(fullName);
  });
  const skipped = prompts
    .filter((p) => existing.has(`${prefix}/${p.name}`))
    .map((p) => `${prefix}/${p.name}`);

  // 中文注释：翻译 name（act/角色名）
  const zh = await translateBatchToZh(toImport.map((p) => p.name));

  const created: Asset[] = [];
  for (let i = 0; i < toImport.length; i++) {
    const p = toImport[i];
    const fullName = `${prefix}/${p.name}`;
    const asset = assetService.create({
      kind: 'prompt',
      name: fullName,
      description: p.name,
      descriptionZh: zh[i] ?? '',
      source: 'github',
      content: p.content,
      contentType: 'text',
      tags: ['github', 'prompt'],
    });
    existing.add(fullName);
    created.push(asset);
  }

  return { created, skipped };
}
