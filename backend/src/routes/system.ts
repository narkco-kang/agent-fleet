import type { FastifyInstance } from 'fastify';
import type { ActionKind, PolicyTier } from '@agentfleet/shared';
import { deviceRegistry } from '../services/deviceRegistry.js';
import { runningCount } from '../services/taskRunner.js';
import { countTasksByStatus } from '../db/repo/tasks.js';
import { isRelayConnected } from '../services/relayClient.js';
import { config } from '../config.js';
import { getDb } from '../db/database.js';
import { tieredPolicy } from '../services/tieredPolicy.js';
import { healthBoard } from '../services/healthBoard.js';
import { effectQueue } from '../services/effects/effectQueue.js';
import { listPolicyNotices } from '../db/repo/confirmations.js';
import {
  listProbeResults,
  runModelHealthCheck,
} from '../services/routing/modelProbeHealth.js';

/**
 * 系统路由：健康检查 / 连接状态 / 版本 / 权限目录。
 *
 * DSH 融合（docs/29）新增可观测出口：
 *   - HealthBoard 组件健康（单一写入者、连续 3 次失败才告警）
 *   - 持久副作用队列（pending/dead 可查、dead 可人工复活）
 *   - 策略版本与在途单通知（Mandate）
 *   - 模型真实推理体检（手动跑一轮 + 历史结果）
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
        health: healthBoard.summary(),
        effects: effectQueue.stats(),
      },
    };
  });

  /**
   * 待处理摘要：只把「需要人介入」的东西顶到人面前（DSH 第一原则）。
   * 健康态全部折叠，不占用注意力。
   */
  app.get('/api/system/attention', async () => {
    const db = getDb();
    const needsLogin = (db.prepare(`SELECT COUNT(*) AS n FROM agents WHERE activated = 0`).get() as { n: number }).n;
    const pendingActions = (
      db.prepare(`SELECT COUNT(*) AS n FROM action_confirmations WHERE status = 'pending_confirmation'`).get() as { n: number }
    ).n;
    const alerts = (
      db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status IN ('failed','interrupted')`).get() as { n: number }
    ).n;
    const health = healthBoard.summary();
    const effects = effectQueue.stats();
    const policyNotices = (
      db.prepare(
        `SELECT COUNT(*) AS n FROM action_confirmations
         WHERE status = 'pending_confirmation' AND policy_notice IS NOT NULL AND policy_notice != ''`,
      ).get() as { n: number }
    ).n;
    const failedProbes = (
      db.prepare(`SELECT COUNT(*) AS n FROM model_probe_results WHERE ok = 0`).get() as { n: number }
    ).n;
    return {
      ok: true,
      data: {
        needsLogin,
        pendingActions,
        alerts,
        healthErrors: health.errors,
        healthDegraded: health.degraded,
        deadEffects: effects.dead,
        pendingEffects: effects.pending,
        policyNotices,
        failedProbes,
      },
    };
  });

  /** HealthBoard：组件健康明细 + 汇总 */
  app.get('/api/system/health/components', async () => {
    return {
      ok: true,
      data: { entries: healthBoard.list(), summary: healthBoard.summary() },
    };
  });

  /** 持久副作用队列：按 kind/status 查询 + 汇总 */
  app.get<{ Querystring: { kind?: string; status?: string; limit?: string } }>(
    '/api/system/effects',
    async (req) => {
      const status = req.query.status === 'dead' || req.query.status === 'pending' ? req.query.status : undefined;
      const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
      return {
        ok: true,
        data: {
          rows: effectQueue.list({ kind: req.query.kind, status }, limit),
          stats: effectQueue.stats(),
        },
      };
    },
  );

  /** 人工复活重试耗尽的副作用 */
  app.post<{ Body: { kind?: string; effectKey?: string } }>(
    '/api/system/effects/retry',
    async (req, reply) => {
      const { kind, effectKey } = req.body ?? {};
      if (!kind || !effectKey) {
        return reply.code(400).send({ ok: false, error: 'kind/effectKey required' });
      }
      const row = effectQueue.retry(kind, effectKey);
      if (!row) return reply.code(404).send({ ok: false, error: 'effect not found' });
      return { ok: true, data: row };
    },
  );

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

  /** 策略版本 + 收到变更通知的在途单（Mandate 不撤销，只提示） */
  app.get('/api/actions/policy/notices', async () => {
    return {
      ok: true,
      data: { version: tieredPolicy.version(), notices: listPolicyNotices() },
    };
  });

  /** 模型真实推理体检历史结果 */
  app.get('/api/system/model-probes', async () => {
    return { ok: true, data: listProbeResults() };
  });

  /** 手动跑一轮体检（结果写回路由） */
  app.post('/api/system/model-probes/run', async () => {
    return { ok: true, data: await runModelHealthCheck() };
  });
}
