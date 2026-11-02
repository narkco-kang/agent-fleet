import type { FastifyInstance } from 'fastify';
import { memoryLedger } from '../services/memoryLedger.js';

/**
 * 记忆账本 REST 出口：查询团队账本摘要 + 健康状态 + 语义召回。
 */
export function registerMemoryRoutes(app: FastifyInstance): void {
  app.get('/api/memory/summary', async () => memoryLedger.summary());

  /** 诊断/测试：直接写入一条 change 并出块（用于验证同步链路，不依赖任务执行）。 */
  app.post<{ Body: { note?: string; status?: string } }>(
    '/api/memory/record',
    async (req, reply) => {
      const { note = 'diag', status } = req.body ?? {};
      const block = await memoryLedger.recordChange('set_status', note, status);
      if (!block) {
        return reply.code(409).send({ ok: false, error: 'no_change' });
      }
      return { ok: true, data: { index: block.index, hash: block.hash } };
    },
  );

  /** 语义召回：关键词搜索记忆账本（借鉴 AgentMemory 的 keyless BM25）。 */
  app.get<{ Querystring: { q?: string; limit?: string; mode?: string } }>(
    '/api/memory/search',
    async (req, reply) => {
      const q = req.query.q?.trim();
      if (!q) {
        return reply.code(400).send({ ok: false, error: 'q required' });
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 50);
      const mode = req.query.mode === 'bm25' ? 'bm25' : 'hybrid';
      const data = mode === 'bm25' ? memoryLedger.search(q, limit) : memoryLedger.hybridSearch(q, limit);
      return { ok: true, mode, data };
    },
  );

  /** 相似记忆：近重复检测 / 相似推荐（借鉴 AgentMemory 的 similarTo）。 */
  app.get<{ Querystring: { text?: string; threshold?: string; limit?: string } }>(
    '/api/memory/similar',
    async (req, reply) => {
      const text = req.query.text?.trim();
      if (!text) {
        return reply.code(400).send({ ok: false, error: 'text required' });
      }
      const threshold = Math.min(Math.max(Number(req.query.threshold ?? 0.6) || 0.6, 0.1), 0.95);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 5) || 5, 1), 20);
      return { ok: true, data: memoryLedger.findSimilar(text, threshold, limit) };
    },
  );
}
