import { getDb } from '../database.js';
import type { TaskEvent, TaskEventType } from '@agentmesh/shared';

/** messages 表行结构 */
export interface MessageRow {
  message_id: string;
  task_id: string;
  seq: number;
  event_type: TaskEventType;
  status: string | null;
  data: string;
  ts: number;
}

/** 追加一条任务事件（落库，供时间线回放） */
export function appendMessage(
  taskId: string,
  seq: number,
  eventType: TaskEventType,
  status: string | null,
  data: Record<string, unknown>,
  ts: number,
  messageId: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO messages (message_id, task_id, seq, event_type, status, data, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(messageId, taskId, seq, eventType, status, JSON.stringify(data), ts);
}

/** 按 taskId 查询消息流（按 seq 升序） */
export function listMessagesByTask(taskId: string, limit = 500): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM messages WHERE task_id = ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(taskId, limit) as MessageRow[];
}

/** 转换为 TaskEvent 协议结构 */
export function toTaskEvent(row: MessageRow): TaskEvent {
  return {
    taskId: row.task_id,
    seq: row.seq,
    eventType: row.event_type,
    status: (row.status ?? undefined) as TaskEvent['status'],
    data: JSON.parse(row.data || '{}') as TaskEvent['data'],
    ts: row.ts,
  };
}
