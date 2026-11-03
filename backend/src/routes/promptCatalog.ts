import type { FastifyInstance } from 'fastify';
import {
  importRepoPrompts,
  listRepoPrompts,
  searchGithubPromptRepos,
} from '../services/assets/promptCatalogService.js';

/**
 * 提示词库 REST 出口：
 *  - GET  /api/prompts/github             实时抓取 GitHub 最多星提示词仓库
 *  - GET  /api/prompts/repo/:owner/:repo  列出仓库内具体提示词（解析 prompts.csv / README）
 *  - POST /api/prompts/repo/import        批量导入仓库内提示词为 prompt 资产
 */
export function registerPromptCatalogRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { query?: string; limit?: string } }>(
    '/api/prompts/github',
    async (req, reply) => {
      try {
        const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 20;
        const repos = await searchGithubPromptRepos(req.query.query, limit);
        return { ok: true, data: repos };
      } catch (err) {
        return reply
          .code(502)
          .send({ ok: false, error: `GitHub 抓取失败：${(err as Error).message}` });
      }
    },
  );

  app.get<{ Params: { owner: string; repo: string } }>(
    '/api/prompts/repo/:owner/:repo',
    async (req, reply) => {
      try {
        const prompts = await listRepoPrompts(req.params.owner, req.params.repo);
        return { ok: true, data: prompts };
      } catch (err) {
        return reply
          .code(502)
          .send({ ok: false, error: `GitHub 抓取失败：${(err as Error).message}` });
      }
    },
  );

  app.post<{
    Body: {
      owner: string;
      repo: string;
      prompts: Array<{ name: string; content: string }>;
    };
  }>('/api/prompts/repo/import', async (req, reply) => {
    const { owner, repo, prompts } = req.body ?? {};
    if (!owner || !repo || !Array.isArray(prompts) || prompts.length === 0) {
      return reply.code(400).send({ ok: false, error: 'owner, repo and prompts required' });
    }
    const result = await importRepoPrompts(owner, repo, prompts);
    return { ok: true, data: result };
  });
}
