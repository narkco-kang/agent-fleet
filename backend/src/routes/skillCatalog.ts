import type { FastifyInstance } from 'fastify';
import {
  importGithubSkills,
  importRepoSkills,
  listRepoSkills,
  searchGithubSkills,
} from '../services/assets/skillCatalogService.js';

/**
 * Skills 目录 REST 出口：
 *  - GET  /api/skills/github             实时抓取 GitHub 最多星 skills 仓库
 *  - POST /api/skills/import             批量导入选中仓库为 skill 资产（source=github）
 *  - GET  /api/skills/repo/:owner/:repo  列出仓库内具体子 skill（解析 SKILL.md）
 *  - POST /api/skills/repo/import        批量导入仓库内子 skill
 */
export function registerSkillCatalogRoutes(app: FastifyInstance): void {
  /** 实时抓取 GitHub skills（可传 query 关键词 + limit） */
  app.get<{ Querystring: { query?: string; limit?: string } }>(
    '/api/skills/github',
    async (req, reply) => {
      try {
        const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 20;
        const repos = await searchGithubSkills(req.query.query, limit);
        return { ok: true, data: repos };
      } catch (err) {
        return reply
          .code(502)
          .send({ ok: false, error: `GitHub 抓取失败：${(err as Error).message}` });
      }
    },
  );

  /** 批量导入 GitHub 仓库为 skill 资产 */
  app.post<{
    Body: {
      repos: Array<{ fullName: string; description?: string; url?: string; topics?: string[] }>;
    };
  }>('/api/skills/import', async (req, reply) => {
    const { repos } = req.body ?? {};
    if (!Array.isArray(repos) || repos.length === 0) {
      return reply.code(400).send({ ok: false, error: 'repos required' });
    }
    const result = await importGithubSkills(repos);
    return { ok: true, data: result };
  });

  /** 列出仓库内具体子 skill（解析 SKILL.md frontmatter） */
  app.get<{ Params: { owner: string; repo: string } }>(
    '/api/skills/repo/:owner/:repo',
    async (req, reply) => {
      try {
        const skills = await listRepoSkills(req.params.owner, req.params.repo);
        return { ok: true, data: skills };
      } catch (err) {
        return reply
          .code(502)
          .send({ ok: false, error: `GitHub 抓取失败：${(err as Error).message}` });
      }
    },
  );

  /** 批量导入仓库内子 skill */
  app.post<{
    Body: {
      owner: string;
      repo: string;
      skills: Array<{ name: string; description?: string; path: string }>;
    };
  }>('/api/skills/repo/import', async (req, reply) => {
    const { owner, repo, skills } = req.body ?? {};
    if (!owner || !repo || !Array.isArray(skills) || skills.length === 0) {
      return reply.code(400).send({ ok: false, error: 'owner, repo and skills required' });
    }
    const result = await importRepoSkills(owner, repo, skills);
    return { ok: true, data: result };
  });
}
