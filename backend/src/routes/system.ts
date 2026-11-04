import type { FastifyInstance } from 'fastify';
import type { ActionKind, PolicyTier } from '@agentfleet/shared';
import { deviceRegistry } from '../services/deviceRegistry.js';
import { runningCount } from '../services/taskRunner.js';
import { countTasksByStatus } from '../db/repo/tasks.js';
import { isRelayConnected } from '../services/relayClient.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';
import { tieredPolicy } from '../services/tieredPolicy.js';

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

  /** 权限目录（P2-3）：查询当前 allow/ask/deny 档位 */
  app.get('/api/actions/policy', async () => {
    return { ok: true, data: tieredPolicy.all() };
  });

  /** 权限目录（P2-3）：调整某动作的档位（进程内生效） */
  app.put<{ Body: { kind?: string; tier?: string } }>('/api/actions/policy', async (req, reply) => {
    const kind = req.body?.kind as ActionKind | undefined;
    const tier = req.body?.tier as PolicyTier | undefined;
    if (!kind || !tier || !['allow', 'ask', 'deny'].includes(tier)) {
      return reply.code(400).send({ ok: false, error: 'kind/tier required (tier ∈ allow|ask|deny)' });
    }
    if (!['deploy', 'uninstall', 'asset_deliver', 'loop_start'].includes(kind)) {
      return reply.code(400).send({ ok: false, error: 'unknown action kind' });
    }
    tieredPolicy.setTier(kind, tier);
    return { ok: true, data: tieredPolicy.all() };
  });
}
