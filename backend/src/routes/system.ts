import type { FastifyInstance } from 'fastify';
import { deviceRegistry } from '../services/deviceRegistry.js';
import { runningCount } from '../services/taskRunner.js';
import { countTasksByStatus } from '../db/repo/tasks.js';
import { isRelayConnected } from '../services/relayClient.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';

/**
 * 系统路由：健康检查 / 连接状态 / 版本。
 */
export function registerSystemRoutes(app: FastifyInstance): void {
  /** 健康检查 */
  app.get('/api/system/health', async () => {
    return { ok: true, service: 'agentfleet-backend', ts: Date.now() };
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

  /** 待处理摘要：待激活平台 / 待确认动作 / 告警（供看板「待处理」摘要条） */
  app.get('/api/system/attention', async () => {
    const db = getDb();
    const needsLogin = (db.prepare(`SELECT COUNT(*) AS n FROM agents WHERE activated = 0`).get() as { n: number }).n;
    const pendingActions = (
      db.prepare(`SELECT COUNT(*) AS n FROM action_confirmations WHERE status = 'pending_confirmation'`).get() as { n: number }
    ).n;
    const alerts = (
      db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status IN ('failed','interrupted')`).get() as { n: number }
    ).n;
    return { ok: true, data: { needsLogin, pendingActions, alerts } };
  });
}
