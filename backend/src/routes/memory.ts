import type { FastifyInstance } from 'fastify';
import { memoryLedger } from '../services/memoryLedger.js';

/**
 * 记忆账本 REST 出口：查询团队账本摘要 + 健康状态。
 */
export function registerMemoryRoutes(app: FastifyInstance): void {
  app.get('/api/memory/summary', async () => memoryLedger.summary());
}
