import { getDb } from '../database.js';
import type { AgentInfo, AgentSnapshot, AgentStatus, AgentType } from '@agentfleet/shared';

/** agents 表行结构 */
export interface AgentRow {
  id: number;
  device_id: string;
  agent_type: AgentType;
  display_name: string;
  version: string;
  executable: string;
  status: AgentStatus;
  capabilities: string;
  max_concurrency: number;
  busy_count: number;
  activated: number;
  updated_at: number;
}

/** 能力上报 upsert（同一设备同一 agent 类型唯一；activated 由协调器管理，上报不覆盖） */
export function upsertAgents(deviceId: string, agents: AgentInfo[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO agents
      (device_id, agent_type, display_name, version, executable, status, capabilities, max_concurrency, activated, updated_at)
     VALUES (@deviceId, @agentType, @displayName, @version, @executable, @status, @capabilities, @maxConcurrency, 0, @now)
     ON CONFLICT(device_id, agent_type) DO UPDATE SET
       display_name = excluded.display_name,
       version = excluded.version,
       executable = excluded.executable,
       status = excluded.status,
       capabilities = excluded.capabilities,
       max_concurrency = excluded.max_concurrency,
       updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  for (const a of agents) {
    stmt.run({
      deviceId,
      agentType: a.agentType,
      displayName: a.displayName,
      version: a.version,
      executable: a.executable,
      status: a.status,
      capabilities: JSON.stringify(a.capabilities),
      maxConcurrency: a.maxConcurrency,
      now,
    });
  }
}

/** 按设备删除 agent（设备移除时清理） */
export function deleteAgentsForDevice(deviceId: string): void {
  getDb().prepare(`DELETE FROM agents WHERE device_id = ?`).run(deviceId);
}

/** 更新单个 agent 状态 */
export function setAgentStatus(
  deviceId: string,
  agentType: AgentType,
  status: AgentStatus,
): void {
  getDb()
    .prepare(
      `UPDATE agents SET status = ?, updated_at = ? WHERE device_id = ? AND agent_type = ?`,
    )
    .run(status, Date.now(), deviceId, agentType);
}

/** 设置 agent 是否已登录激活（打开平台应用登录后调用） */
export function setAgentActivated(deviceId: string, agentType: AgentType, activated: boolean): boolean {
  return getDb()
    .prepare(
      `UPDATE agents SET activated = ?, updated_at = ? WHERE device_id = ? AND agent_type = ?`,
    )
    .run(activated ? 1 : 0, Date.now(), deviceId, agentType).changes > 0;
}

/** 认领：busy_count + 1（不超过 max_concurrency），返回是否认领成功 */
export function claimAgent(deviceId: string, agentType: AgentType): boolean {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE agents SET busy_count = busy_count + 1
       WHERE device_id = ? AND agent_type = ? AND busy_count < max_concurrency`,
    )
    .run(deviceId, agentType);
  return info.changes > 0;
}

/** 释放：busy_count - 1（不小于 0） */
export function releaseAgent(deviceId: string, agentType: AgentType): void {
  getDb()
    .prepare(
      `UPDATE agents SET busy_count = CASE WHEN busy_count > 0 THEN busy_count - 1 ELSE 0 END
       WHERE device_id = ? AND agent_type = ?`,
    )
    .run(deviceId, agentType);
}

/** 列出某设备全部 agent */
export function listAgentsByDevice(deviceId: string): AgentRow[] {
  return getDb()
    .prepare(`SELECT * FROM agents WHERE device_id = ?`)
    .all(deviceId) as AgentRow[];
}

/** 列出全部 agent */
export function listAgents(): AgentRow[] {
  return getDb().prepare(`SELECT * FROM agents`).all() as AgentRow[];
}

/** 构造看板快照 agent 节点 */
export function toAgentSnapshot(row: AgentRow): AgentSnapshot {
  return {
    deviceId: row.device_id,
    agentType: row.agent_type,
    displayName: row.display_name,
    version: row.version,
    executable: row.executable,
    status: row.status,
    capabilities: JSON.parse(row.capabilities || '[]') as string[],
    maxConcurrency: row.max_concurrency,
    busyCount: row.busy_count,
    activated: row.activated === 1,
  };
}
