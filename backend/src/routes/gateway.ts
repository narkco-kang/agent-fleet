import type { FastifyInstance } from 'fastify';
import { gatewayManager } from '../services/gateway/gatewayManager.js';
import {
  paidProviderConfigStatus,
  savePaidProviders,
  type PaidProviderInput,
} from '../services/gateway/providerConfigStore.js';

/**
 * 协调器组件（内置 modelgateway）REST 出口：
 * GET /api/gateway/component/status
 * POST /api/gateway/component/build | start | stop
 * GET /api/gateway/component/health
 * GET/POST /api/gateway/providers
 */
export function registerGatewayRoutes(app: FastifyInstance): void {
  app.get('/api/gateway/component/status', async () => {
    return { ok: true, data: gatewayManager.getStatus() };
  });

  app.post('/api/gateway/component/build', async (_req, reply) => {
    try {
      return { ok: true, data: await gatewayManager.build() };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/gateway/component/start', async (_req, reply) => {
    try {
      return { ok: true, data: await gatewayManager.start() };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/gateway/component/stop', async (_req, reply) => {
    try {
      return { ok: true, data: await gatewayManager.stop() };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/gateway/component/health', async () => {
    return { ok: true, data: await gatewayManager.health() };
  });

  app.get('/api/gateway/providers', async () => {
    return { ok: true, data: paidProviderConfigStatus() };
  });

  app.post<{ Body: { providers: PaidProviderInput[] } }>('/api/gateway/providers', async (req, reply) => {
    try {
      const providers = savePaidProviders((req.body ?? {}).providers ?? []);
      return { ok: true, data: { ...paidProviderConfigStatus(), providers } };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });
}
