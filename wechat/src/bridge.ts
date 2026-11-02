import axios from 'axios';
import { config } from './config.js';
import type { ParsedCommand } from '@agentfleet/shared';

/**
 * 微信 ↔ 后端桥接：消息 → 任务下发（POST /api/tasks）；结果 → 回推微信消息。
 */

export interface BridgeSubmitResult {
  taskId: string;
  status: string;
  assignedText?: string;
}

/** 命令 → 后端任务 */
export async function submitToBackend(cmd: ParsedCommand): Promise<BridgeSubmitResult> {
  if (cmd.kind !== 'task') {
    throw new Error('not a task command');
  }
  const res = await axios.post(
    `${config.backendUrl}/api/tasks`,
    {
      prompt: cmd.prompt,
      origin: cmd.origin,
      originRef: 'wechat-user',
      target: cmd.target,
    },
    { timeout: 10_000 },
  );
  const data = res.data as { data: { taskId: string; status: string } };
  return { taskId: data.data.taskId, status: data.data.status };
}

/** 查询队列摘要（/status） */
export async function fetchQueueSummary(): Promise<string> {
  const res = await axios.get(`${config.backendUrl}/api/system/status`, { timeout: 10_000 });
  const d = res.data as { data: { devicesOnline: number; tasksByStatus: Record<string, number> } };
  const s = d.data.tasksByStatus ?? {};
  return `在线设备 ${d.data.devicesOnline} · 排队 ${s.queued ?? 0} · 运行中 ${s.running ?? 0} · 完成 ${s.completed ?? 0}`;
}

/** 取消任务（/cancel #id） */
export async function cancelTaskOnBackend(taskId: string): Promise<boolean> {
  try {
    await axios.post(`${config.backendUrl}/api/tasks/${encodeURIComponent(taskId)}/cancel`, {}, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
