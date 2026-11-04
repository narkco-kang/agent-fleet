import { getDb } from '../database.js';
import { randomId } from '../../security/auth.js';

/**
 * 决策门（P0-5）：agent 执行中上报带选项决策门，任务 blocked 等人类 resolve。
 */

export interface DecisionGate {
  gateId: string;
  taskId: string;
  title: string;
  options: string[];
  status: 'open' | 'resolved';
  resolvedOption: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

interface DecisionGateRow {
  gate_id: string;
  task_id: string;
  title: string;
  options: string;
  status: string;
  resolved_option: string | null;
  created_at: number;
  resolved_at: number | null;
}

function rowToGate(row: DecisionGateRow): DecisionGate {
  return {
    gateId: row.gate_id,
    taskId: row.task_id,
    title: row.title,
    options: JSON.parse(row.options || '[]') as string[],
    status: row.status === 'resolved' ? 'resolved' : 'open',
    resolvedOption: row.resolved_option,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** 创建决策门（任务阻塞） */
export function createGate(taskId: string, title: string, options: string[]): DecisionGate {
  const gateId = randomId('gate');
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO decision_gates (gate_id, task_id, title, options, status, created_at)
       VALUES (?, ?, ?, ?, 'open', ?)`,
    )
    .run(gateId, taskId, title, JSON.stringify(options), now);
  return getGate(gateId)!;
}

/** 查决策门 */
export function getGate(gateId: string): DecisionGate | undefined {
  const row = getDb().prepare(`SELECT * FROM decision_gates WHERE gate_id = ?`).get(gateId) as
    | DecisionGateRow
    | undefined;
  return row ? rowToGate(row) : undefined;
}

/** 查任务当前打开的决策门 */
export function getOpenGate(taskId: string): DecisionGate | null {
  const row = getDb()
    .prepare(`SELECT * FROM decision_gates WHERE task_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`)
    .get(taskId) as DecisionGateRow | undefined;
  return row ? rowToGate(row) : null;
}

/** resolve 决策门（人类选择选项） */
export function resolveGate(gateId: string, option: string): DecisionGate | undefined {
  const gate = getGate(gateId);
  if (!gate || gate.status === 'resolved') return undefined;
  if (!gate.options.includes(option)) return undefined;
  getDb()
    .prepare(
      `UPDATE decision_gates SET status = 'resolved', resolved_option = ?, resolved_at = ? WHERE gate_id = ?`,
    )
    .run(option, Date.now(), gateId);
  return getGate(gateId);
}
