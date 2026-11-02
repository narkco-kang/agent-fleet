import { getDb } from '../database.js';
import type { AgentType, PlatformModelBinding } from '@agentfleet/shared';

/**
 * 平台模型绑定表（platform_models）CRUD。
 * 键：(device_id, agent_type) → 主模型 + 兜底 + 当前生效模型 + 状态。
 */

export interface PlatformModelRow {
  device_id: string;
  agent_type: AgentType;
  model: string;
  fallbacks: string;
  active_model: string;
  excluded: string;
  state: 'ok' | 'degraded';
  updated_at: number;
}

export function rowToBinding(row: PlatformModelRow): PlatformModelBinding {
  return {
    deviceId: row.device_id,
    agentType: row.agent_type,
    model: row.model,
    fallbacks: JSON.parse(row.fallbacks || '[]') as string[],
    activeModel: row.active_model,
    excluded: JSON.parse(row.excluded || '[]') as string[],
    state: row.state,
    updatedAt: row.updated_at,
  };
}

export function upsertBinding(input: {
  deviceId: string;
  agentType: AgentType;
  model: string;
  fallbacks: string[];
  activeModel?: string;
  excluded?: string[];
  state?: 'ok' | 'degraded';
}): PlatformModelBinding {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO platform_models (device_id, agent_type, model, fallbacks, active_model, excluded, state, updated_at)
       VALUES (@deviceId, @agentType, @model, @fallbacks, @activeModel, @excluded, @state, @now)
       ON CONFLICT(device_id, agent_type) DO UPDATE SET
         model = excluded.model,
         fallbacks = excluded.fallbacks,
         active_model = excluded.active_model,
         excluded = excluded.excluded,
         state = excluded.state,
         updated_at = excluded.updated_at`,
    )
    .run({
      deviceId: input.deviceId,
      agentType: input.agentType,
      model: input.model,
      fallbacks: JSON.stringify(input.fallbacks),
      activeModel: input.activeModel ?? input.model,
      excluded: JSON.stringify(input.excluded ?? []),
      state: input.state ?? 'ok',
      now,
    });
  return getBinding(input.deviceId, input.agentType) as PlatformModelBinding;
}

export function getBinding(deviceId: string, agentType: AgentType): PlatformModelBinding | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM platform_models WHERE device_id = ? AND agent_type = ?`)
    .get(deviceId, agentType) as PlatformModelRow | undefined;
  return row ? rowToBinding(row) : undefined;
}

export function listBindings(limit = 500): PlatformModelBinding[] {
  const rows = getDb()
    .prepare(`SELECT * FROM platform_models ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as PlatformModelRow[];
  return rows.map(rowToBinding);
}

export function setActive(
  deviceId: string,
  agentType: AgentType,
  activeModel: string,
  state: 'ok' | 'degraded',
  excluded: string[] = [],
): PlatformModelBinding | undefined {
  const now = Date.now();
  const res = getDb()
    .prepare(
      `UPDATE platform_models SET active_model = ?, state = ?, excluded = ?, updated_at = ? WHERE device_id = ? AND agent_type = ?`,
    )
    .run(activeModel, state, JSON.stringify(excluded), now, deviceId, agentType);
  return res.changes > 0 ? getBinding(deviceId, agentType) : undefined;
}

export function deleteBinding(deviceId: string, agentType?: AgentType): number {
  if (agentType) {
    return getDb()
      .prepare(`DELETE FROM platform_models WHERE device_id = ? AND agent_type = ?`)
      .run(deviceId, agentType).changes;
  }
  return getDb().prepare(`DELETE FROM platform_models WHERE device_id = ?`).run(deviceId).changes;
}
