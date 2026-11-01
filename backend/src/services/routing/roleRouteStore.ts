import fs from 'node:fs';
import type { AgentType, RoleCapability, RoleRoute } from '@agentmesh/shared';
import {
  deleteRoleRoute,
  getRoleRoute,
  importRoleRoutes,
  listRoleRoutes,
  upsertRoleRoute,
} from '../../db/repo/roleRoutes.js';

/**
 * 角色路由表内存副本 + 启动导入（agent-role-routes.json）。
 *
 * 单一事实源为 SQLite role_routes 表；本 store 维护内存缓存供 roleRouter 高频读取。
 * 导入结构对齐 modelgateway `data/agent-role-routes.json`：
 *   - 对象映射：{ [role]: { primary, fallback?, capability?, bots? } }
 *   - 数组：[{ role, primary, fallback?, capability?, bots?, deviceId?, agentType?, model?, enabled? }]
 */

/** 默认角色路由（对齐 09 文档 agent-role-routes.json 的 8 个内置角色，仅网关模型 ref） */
export const DEFAULT_ROLE_ROUTES: RoleRoute[] = [
  { role: 'research', primary: 'kimi/k3.1-pro-highspeed', fallback: [], capability: 'chat', bots: ['Kimi仔'], enabled: true },
  { role: 'execution', primary: 'mgs-tiered/group/mini-tiered', fallback: [], capability: 'chat', bots: ['Mini仔'], enabled: true },
  { role: 'reasoning', primary: 'mgs-glm/group/strong', fallback: [], capability: 'chat', bots: ['Glm仔'], enabled: true },
  { role: 'review-verdict', primary: 'jev-ai/jev-latest', fallback: [], capability: 'decision-only', bots: ['Jev仔'], enabled: true },
  { role: 'external-claude', primary: 'mgs-claude/group/strong', fallback: [], capability: 'chat', bots: ['Claude仔'], enabled: true },
  { role: 'external-hermes', primary: 'mgs-hermes/group/long-context', fallback: [], capability: 'chat', bots: ['Hermes仔'], enabled: true },
  { role: 'external-codex', primary: 'gpt/gpt-6.1-sol', fallback: [], capability: 'chat', bots: ['Codex仔'], enabled: true },
  { role: 'free-tier', primary: 'free-models/kilo-auto/free', fallback: [], capability: 'chat', bots: ['Free仔'], enabled: true },
];

/** 容错地把任意导入条目规范化为 RoleRoute */
export function normalizeRoleRoute(raw: unknown, roleKey?: string): RoleRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const role = (typeof obj.role === 'string' ? obj.role : roleKey) ?? '';
  if (!role) return null;
  const primary = typeof obj.primary === 'string' ? obj.primary : '';
  if (!primary) return null;

  const fallback = Array.isArray(obj.fallback)
    ? obj.fallback.filter((x): x is string => typeof x === 'string')
    : [];
  const bots = Array.isArray(obj.bots)
    ? obj.bots.filter((x): x is string => typeof x === 'string')
    : [];

  const capability: RoleCapability = obj.capability === 'decision-only' ? 'decision-only' : 'chat';

  return {
    role,
    primary,
    fallback,
    capability,
    bots,
    deviceId: typeof obj.deviceId === 'string' ? obj.deviceId : undefined,
    agentType: typeof obj.agentType === 'string' ? (obj.agentType as AgentType) : undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
    enabled: obj.enabled !== false,
  };
}

class RoleRouteStore {
  private cache = new Map<string, RoleRoute>();

  /** 从 DB 重载缓存 */
  reload(): void {
    this.cache = new Map(listRoleRoutes().map((r) => [r.role, r]));
  }

  /** 查询（未加载则先重载） */
  get(role: string): RoleRoute | undefined {
    if (this.cache.size === 0) this.reload();
    return this.cache.get(role);
  }

  /** 列出全部 */
  list(): RoleRoute[] {
    if (this.cache.size === 0) this.reload();
    return Array.from(this.cache.values());
  }

  /** 写入单条（DB + 缓存） */
  set(route: RoleRoute): void {
    upsertRoleRoute(route);
    this.cache.set(route.role, route);
  }

  /** 删除 */
  delete(role: string): void {
    deleteRoleRoute(role);
    this.cache.delete(role);
  }

  /** 批量导入（返回条数） */
  importRoutes(routes: RoleRoute[]): number {
    const n = importRoleRoutes(routes);
    this.reload();
    return n;
  }

  /** 从 JSON 文件导入 */
  importFromJsonFile(filePath: string): number {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return this.importFromJson(raw);
  }

  /** 从 JSON 字符串导入（对象映射或数组） */
  importFromJson(json: string): number {
    const data: unknown = JSON.parse(json);
    return this.importFromObject(data);
  }

  /** 从已解析对象导入 */
  importFromObject(data: unknown): number {
    const routes: RoleRoute[] = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        const route = normalizeRoleRoute(item);
        if (route) routes.push(route);
      }
    } else if (data && typeof data === 'object') {
      for (const [role, item] of Object.entries(data as Record<string, unknown>)) {
        const route = normalizeRoleRoute(item, role);
        if (route) routes.push(route);
      }
    }
    return routes.length ? this.importRoutes(routes) : 0;
  }

  /** 表为空时播种默认角色路由（幂等） */
  seedDefaults(): number {
    if (this.cache.size === 0) this.reload();
    if (this.cache.size > 0) return 0;
    return this.importRoutes(DEFAULT_ROLE_ROUTES);
  }
}

/** 全局单例 */
export const roleRouteStore = new RoleRouteStore();
