import type { FastifyInstance } from 'fastify';
import { memoryLedger } from '../services/memoryLedger.js';

/**
 * 记忆账本 REST 出口：查询团队账本摘要 + 健康状态 + 语义召回。
 */
export function registerMemoryRoutes(app: FastifyInstance): void {
  app.get('/api/memory/summary', async () => memoryLedger.summary());

  /** 语义召回：关键词搜索记忆账本（借鉴 AgentMemory 的 keyless BM25）。 */
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/memory/search',
    async (req, reply) => {
      const q = req.query.q?.trim();
      if (!q) {
        return reply.code(400).send({ ok: false, error: 'q required' });
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 50);
      return { ok: true, data: memoryLedger.search(q, limit) };
    },
  );
}
