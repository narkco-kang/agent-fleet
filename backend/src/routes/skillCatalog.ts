import type { FastifyInstance } from 'fastify';
import {
  importGithubSkills,
  searchGithubSkills,
} from '../services/assets/skillCatalogService.js';

/**
 * Skills 目录 REST 出口：
 *  - GET  /api/skills/github    实时抓取 GitHub 最多星 skills 仓库
 *  - POST /api/skills/import    批量导入选中仓库为 skill 资产（source=github）
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
    const result = importGithubSkills(repos);
    return { ok: true, data: result };
  });
}
