import type { FastifyInstance } from 'fastify';
import { deviceRegistry } from '../services/deviceRegistry.js';
import { runningCount } from '../services/taskRunner.js';
import { countTasksByStatus } from '../db/repo/tasks.js';
import { isRelayConnected } from '../services/relayClient.js';
import { config } from '../config.js';

/**
 * 系统路由：健康检查 / 连接状态 / 版本。
 */
export function registerSystemRoutes(app: FastifyInstance): void {
  /** 健康检查 */
  app.get('/api/system/health', async () => {
    return { ok: true, service: 'agentmesh-backend', ts: Date.now() };
  });

  /** 连接状态（看板顶栏指示） */
  app.get('/api/system/status', async () => {
    const online = deviceRegistry.onlineIds().length;
    const running = runningCount();
    const byStatus = countTasksByStatus();
    return {
      ok: true,
      data: {
        devicesOnline: online,
        devicesTotal: deviceRegistry.all().length,
        tasksRunning: running,
        tasksByStatus: byStatus,
        relayConnected: isRelayConnected(),
        relayUrl: config.relayUrl,
        version: '0.1.0',
      },
    };
  });
}
