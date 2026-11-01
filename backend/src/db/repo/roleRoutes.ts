import { getDb } from '../database.js';
import type { AgentType, RoleCapability, RoleRoute } from '@agentmesh/shared';

/**
 * 角色路由表（role_routes）CRUD + 导入。
 * 行结构 snake_case，对外暴露 shared.RoleRoute（camelCase）。
 */

export interface RoleRouteRow {
  role: string;
  primary_ref: string;
  fallback_refs: string;
  capability: RoleCapability;
  bots: string;
  device_id: string | null;
  agent_type: AgentType | null;
  model: string | null;
  enabled: number;
  updated_at: number;
}

/** 行 → shared.RoleRoute */
export function rowToRoleRoute(row: RoleRouteRow): RoleRoute {
  return {
    role: row.role,
    primary: row.primary_ref,
    fallback: JSON.parse(row.fallback_refs || '[]') as string[],
    capability: row.capability,
    bots: JSON.parse(row.bots || '[]') as string[],
    deviceId: row.device_id ?? undefined,
    agentType: row.agent_type ?? undefined,
    model: row.model ?? undefined,
    enabled: row.enabled === 1,
  };
}

/** 插入或更新角色路由 */
export function upsertRoleRoute(route: RoleRoute): void {
  getDb()
    .prepare(
      `INSERT INTO role_routes
        (role, primary_ref, fallback_refs, capability, bots, device_id, agent_type, model, enabled, updated_at)
       VALUES (@role, @primary, @fallback, @capability, @bots, @deviceId, @agentType, @model, @enabled, @now)
       ON CONFLICT(role) DO UPDATE SET
         primary_ref = excluded.primary_ref,
         fallback_refs = excluded.fallback_refs,
         capability = excluded.capability,
         bots = excluded.bots,
         device_id = excluded.device_id,
         agent_type = excluded.agent_type,
         model = excluded.model,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run({
      role: route.role,
      primary: route.primary,
      fallback: JSON.stringify(route.fallback),
      capability: route.capability,
      bots: JSON.stringify(route.bots),
      deviceId: route.deviceId ?? null,
      agentType: route.agentType ?? null,
      model: route.model ?? null,
      enabled: route.enabled ? 1 : 0,
      now: Date.now(),
    });
}

/** 查询单个角色路由 */
export function getRoleRoute(role: string): RoleRoute | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM role_routes WHERE role = ?`)
    .get(role) as RoleRouteRow | undefined;
  return row ? rowToRoleRoute(row) : undefined;
}

/** 列出全部角色路由 */
export function listRoleRoutes(): RoleRoute[] {
  const rows = getDb().prepare(`SELECT * FROM role_routes ORDER BY role ASC`).all() as RoleRouteRow[];
  return rows.map(rowToRoleRoute);
}

/** 删除角色路由 */
export function deleteRoleRoute(role: string): void {
  getDb().prepare(`DELETE FROM role_routes WHERE role = ?`).run(role);
}

/** 批量导入（返回导入条数） */
export function importRoleRoutes(routes: RoleRoute[]): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO role_routes
      (role, primary_ref, fallback_refs, capability, bots, device_id, agent_type, model, enabled, updated_at)
     VALUES (@role, @primary, @fallback, @capability, @bots, @deviceId, @agentType, @model, @enabled, @now)
     ON CONFLICT(role) DO UPDATE SET
       primary_ref = excluded.primary_ref,
       fallback_refs = excluded.fallback_refs,
       capability = excluded.capability,
       bots = excluded.bots,
       device_id = excluded.device_id,
       agent_type = excluded.agent_type,
       model = excluded.model,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  const tx = db.transaction((items: RoleRoute[]) => {
    for (const route of items) {
      stmt.run({
        role: route.role,
        primary: route.primary,
        fallback: JSON.stringify(route.fallback ?? []),
        capability: route.capability ?? 'chat',
        bots: JSON.stringify(route.bots ?? []),
        deviceId: route.deviceId ?? null,
        agentType: route.agentType ?? null,
        model: route.model ?? null,
        enabled: route.enabled === false ? 0 : 1,
        now,
      });
    }
  });
  tx(routes);
  return routes.length;
}
