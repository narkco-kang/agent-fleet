import type { FastifyInstance } from 'fastify';
import type { TaskStatus } from '@agentfleet/shared';
import { enqueueTask } from '../services/scheduler.js';
import { getTask, toTaskSnapshot } from '../db/repo/tasks.js';
import { createSession, makeTitle } from '../db/repo/sessions.js';
import { cancelTask } from '../services/taskRunner.js';
import { randomId } from '../security/auth.js';

/**
 * A2A（Agent2Agent）端点：让 AgentFleet 蜂群被外部 agent 发现并调用。
 *
 * - GET /.well-known/agent.json  → Agent Card（能力发现）
 * - POST /                        → JSON-RPC：tasks/send（提交）、tasks/get（查询）、tasks/cancel（取消）
 *
 * 任务生命周期映射：queued→submitted、running→working、completed→completed、failed/interrupted/cancelled→failed。
 */

const AGENT_CARD = {
  name: 'AgentFleet',
  description: 'Cross-device AI orchestration — every device a ship. Delegate a task and the fleet dispatches it to the best device+agent.',
  version: '0.1.0',
  capabilities: { streaming: true },
  skills: [
    { id: 'cross_device_task', name: 'Cross-device task dispatch' },
    { id: 'coding_task', name: 'Coding task (13+ agent platforms)' },
    { id: 'team_task', name: 'Team-mode task (software / content teams)' },
  ],
};

type RpcRequest = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> };

export function extractText(message: unknown): string {
  const m = message as { parts?: Array<{ text?: string }> } | undefined;
  return (m?.parts ?? []).map((p) => p.text ?? '').join('\n').trim();
}

export function mapStatus(s: TaskStatus): 'submitted' | 'working' | 'completed' | 'failed' {
  switch (s) {
    case 'queued':
    case 'waiting':
      return 'submitted';
    case 'running':
      return 'working';
    case 'completed':
      return 'completed';
    default:
      return 'failed'; // failed / interrupted / cancelled
  }
}

export function registerA2aRoutes(app: FastifyInstance): void {
  app.get('/.well-known/agent.json', async () => AGENT_CARD);

  app.post('/', async (req, reply) => {
    const body = (req.body ?? {}) as RpcRequest;
    const { id, method, params } = body;
    const respond = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

    switch (method) {
      case 'tasks/send': {
        const text = extractText(params?.message);
        if (!text) return reply.send(err(-32602, 'message.parts[].text required'));
        const sessionId = randomId('session');
        const taskId = randomId('task');
        createSession(sessionId, 'dashboard', 'a2a', makeTitle(text));
        enqueueTask({
          taskId,
          sessionId,
          origin: 'dashboard',
          originRef: 'a2a',
          prompt: text,
          targetMode: 'auto',
        });
        return reply.send(respond({ id: taskId, status: 'submitted' }));
      }

      case 'tasks/get': {
        const taskId = (params?.id as string) ?? '';
        if (!taskId) return reply.send(err(-32602, 'id required'));
        const row = getTask(taskId);
        if (!row) return reply.send(err(-32000, 'task not found'));
        const snap = toTaskSnapshot(row);
        return reply.send(
          respond({
            id: row.task_id,
            status: mapStatus(snap.status),
            artifact: snap.resultText ? { parts: [{ text: snap.resultText }] } : undefined,
          }),
        );
      }

      case 'tasks/cancel': {
        const taskId = (params?.id as string) ?? '';
        if (!taskId) return reply.send(err(-32602, 'id required'));
        const ok = cancelTask(taskId, 'user_cancel');
        return reply.send(respond({ id: taskId, canceled: ok }));
      }

      default:
        return reply.send(err(-32601, `method not found: ${method ?? '(none)'}`));
    }
  });
}
