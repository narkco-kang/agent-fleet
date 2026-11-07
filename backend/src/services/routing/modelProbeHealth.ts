import type { RoleRoute } from '@agentfleet/shared';
import { reasonOf, reasonText } from '@agentfleet/shared';
import { getDb } from '../../db/database.js';
import { config } from '../../config.js';
import { healthBoard } from '../healthBoard.js';
import { roleRouteStore } from './roleRouteStore.js';
import * as platformModelService from './platformModelService.js';
import { modelGatewayClient, type ModelProbeResult } from './modelGatewayClient.js';

/**
 * 模型真实推理体检闭环（借鉴 dsh-team-workbench 2.99.1「模型路由真实推理体检」）。
 *
 * 与既有 `probeFreeSources()` 的区别：那个只出报告，这个**把结论写回路由决策**：
 *   1. 收集所有在用的模型 ref（角色路由 primary/fallback/model + 平台绑定主/兜底/当前）
 *   2. 逐个发最小 chat 请求（真实推理，不是 /models 元数据探测）
 *   3. 结果持久化到 model_probe_results（重启不丢、可审计）
 *   4. 失败模型 → 平台绑定走 markModelFailed 自动切兜底/降级；
 *                 角色路由 promote 到健康兜底，无兜底则 enabled=false
 *   5. 恢复模型 → 清掉平台绑定的排除表 + 依据 model_probe_actions 精确复原角色路由
 *   6. 全链路接 HealthBoard：连续 3 次体检异常才升 error，成功一次即清除
 *
 * 安全护栏（避免把网络故障误判成「所有模型都坏了」，进而清空整套路由）：
 *   - modelgateway 未配置 → 直接返回，不做任何清理
 *   - 本轮**全部探测失败** → 判定为基础设施故障，只记 health.failure，不动任何配置
 *   - 只有「至少有一个模型成功」时，才把失败项视为该模型自身的问题
 */

export interface ModelProbeRecord {
  model: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
  checkedAt: number;
}

export interface ModelHealthActions {
  bindingsSwitched: number;
  bindingsDegraded: number;
  bindingsRecovered: number;
  routesPromoted: number;
  routesDisabled: number;
  routesRestored: number;
}

export interface ModelHealthReport {
  checkedAt: number;
  configured: boolean;
  /** 基础设施故障（全部失败）时跳过清理，仅记录 */
  infrastructureFailure: boolean;
  total: number;
  ok: number;
  failed: number;
  results: ModelProbeResult[];
  actions: ModelHealthActions;
  reason: string;
}

interface ProbeActionRow {
  role: string;
  original_primary: string;
  switched_to: string;
  created_at: number;
}

const EMPTY_ACTIONS = (): ModelHealthActions => ({
  bindingsSwitched: 0,
  bindingsDegraded: 0,
  bindingsRecovered: 0,
  routesPromoted: 0,
  routesDisabled: 0,
  routesRestored: 0,
});

/** 收集所有「会影响实际调度」的模型 ref，去重 */
export function collectActiveModelRefs(): string[] {
  const refs = new Set<string>();
  for (const route of roleRouteStore.list()) {
    for (const m of [route.primary, route.model, ...route.fallback]) {
      if (m) refs.add(m);
    }
  }
  for (const b of platformModelService.list()) {
    for (const m of [b.model, b.activeModel, ...b.fallbacks]) {
      if (m) refs.add(m);
    }
  }
  return Array.from(refs);
}

/** 落盘一条体检结果（幂等 upsert） */
export function recordProbeResult(result: ModelProbeResult): void {
  getDb()
    .prepare(
      `INSERT INTO model_probe_results (model, ok, latency_ms, detail, checked_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(model) DO UPDATE SET
         ok = excluded.ok, latency_ms = excluded.latency_ms,
         detail = excluded.detail, checked_at = excluded.checked_at`,
    )
    .run(
      result.model,
      result.ok ? 1 : 0,
      result.latencyMs,
      result.error ?? result.text ?? '',
      Date.now(),
    );
}

export function listProbeResults(): ModelProbeRecord[] {
  const rows = getDb()
    .prepare(`SELECT * FROM model_probe_results ORDER BY checked_at DESC`)
    .all() as Array<{
    model: string;
    ok: number;
    latency_ms: number;
    detail: string;
    checked_at: number;
  }>;
  return rows.map((r) => ({
    model: r.model,
    ok: r.ok === 1,
    latencyMs: r.latency_ms,
    detail: r.detail,
    checkedAt: r.checked_at,
  }));
}

/** 找出因体检被自动改过、且原模型已恢复的角色路由 */
function pendingRestores(okModels: Set<string>): ProbeActionRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM model_probe_actions`)
    .all() as ProbeActionRow[];
  return rows.filter((r) => okModels.has(r.original_primary));
}

function rememberRouteChange(role: string, originalPrimary: string, switchedTo: string): void {
  getDb()
    .prepare(
      `INSERT INTO model_probe_actions (role, original_primary, switched_to, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET
         original_primary = excluded.original_primary,
         switched_to = excluded.switched_to,
         created_at = excluded.created_at`,
    )
    .run(role, originalPrimary, switchedTo, Date.now());
}

function forgetRouteChange(role: string): void {
  getDb().prepare(`DELETE FROM model_probe_actions WHERE role = ?`).run(role);
}

/** 失败模型：平台绑定自动切兜底 + 角色路由 promote/禁用 */
function applyFailedModels(
  failedModels: string[],
  okModels: Set<string>,
  actions: ModelHealthActions,
): void {
  const bindings = platformModelService.list();
  for (const model of failedModels) {
    for (const b of bindings) {
      if (b.activeModel !== model) continue;
      const r = platformModelService.markModelFailed(b.deviceId, b.agentType, model);
      if (r.degraded) actions.bindingsDegraded++;
      else if (r.switchedTo) actions.bindingsSwitched++;
    }
  }

  const routes = roleRouteStore.list();
  for (const model of failedModels) {
    for (const route of routes) {
      if (route.primary !== model) continue;
      // 已被前面某轮处理过（同一模型可能既是 primary 又是别的 route 的 fallback）
      if (getDb().prepare(`SELECT 1 FROM model_probe_actions WHERE role = ?`).get(route.role)) continue;
      const healthy = route.fallback.find((m) => okModels.has(m) && !failedModels.includes(m));
      if (healthy) {
        const fallback = Array.from(
          new Set([model, ...route.fallback.filter((m) => m !== healthy)]),
        );
        roleRouteStore.set({ ...route, primary: healthy, fallback } satisfies RoleRoute);
        rememberRouteChange(route.role, model, healthy);
        actions.routesPromoted++;
      } else {
        roleRouteStore.set({ ...route, enabled: false } satisfies RoleRoute);
        rememberRouteChange(route.role, model, '');
        actions.routesDisabled++;
      }
    }
  }
}

/** 恢复模型：清排除表 + 按记录复原角色路由（不覆盖用户手工改动之外的状态） */
function applyRecoveredModels(okModels: Set<string>, actions: ModelHealthActions): void {
  for (const b of platformModelService.list()) {
    const hadFailure = b.state === 'degraded' || b.excluded.some((m) => okModels.has(m));
    if (!hadFailure) continue;
    platformModelService.reset(b.deviceId, b.agentType);
    actions.bindingsRecovered++;
  }

  for (const record of pendingRestores(okModels)) {
    const route = roleRouteStore.get(record.role);
    if (!route) {
      forgetRouteChange(record.role);
      continue;
    }
    const fallback = Array.from(
      new Set([
        ...(record.switched_to ? [record.switched_to] : []),
        ...route.fallback.filter((m) => m !== record.original_primary),
      ]),
    );
    roleRouteStore.set({
      ...route,
      primary: record.original_primary,
      fallback,
      enabled: true,
    } satisfies RoleRoute);
    forgetRouteChange(record.role);
    actions.routesRestored++;
  }
}

/**
 * 跑一轮真实推理体检。可通过 probe 参数注入探测实现（单测无需真实网关）。
 */
export async function runModelHealthCheck(
  probe: (models: string[]) => Promise<ModelProbeResult[]> = (models) =>
    modelGatewayClient.probeModels(models, { prompt: 'ping', autoCheckin: false }),
): Promise<ModelHealthReport> {
  const checkedAt = Date.now();
  const actions = EMPTY_ACTIONS();
  const health = healthBoard.claim('model-probe', 'modelProbeHealth');

  if (!modelGatewayClient.isConfigured()) {
    return {
      checkedAt,
      configured: false,
      infrastructureFailure: false,
      total: 0,
      ok: 0,
      failed: 0,
      results: [],
      actions,
      reason: reasonText(reasonOf('executorMissing', { kind: 'modelgateway' })),
    };
  }

  const refs = collectActiveModelRefs();
  const results = refs.length ? await probe(refs) : [];
  for (const r of results) recordProbeResult(r);

  const okModels = new Set(results.filter((r) => r.ok).map((r) => r.model));
  const failedModels = results.filter((r) => !r.ok).map((r) => r.model);
  // 全部失败 = 网关/网络故障，不是模型个体的错 → 不做破坏性清理
  const infrastructureFailure = failedModels.length > 0 && okModels.size === 0;

  if (!infrastructureFailure) {
    applyRecoveredModels(okModels, actions);
    if (failedModels.length) applyFailedModels(failedModels, okModels, actions);
  }

  const reason = infrastructureFailure
    ? reasonOf('probeFailed', { detail: '全部模型探测失败，判定为网关/网络故障，已跳过路由清理' })
    : failedModels.length
      ? reasonOf('modelUnavailable', { model: failedModels.slice(0, 3).join(', ') })
      : reasonOf('said', { text: '全部模型真实推理探测通过' });

  if (failedModels.length === 0) health.ok();
  // 网关/网络故障有自动本地降级兜底，只标 degraded，不占用人的注意力
  else if (infrastructureFailure) health.warn(reason);
  else health.failure(reason);

  return {
    checkedAt,
    configured: true,
    infrastructureFailure,
    total: results.length,
    ok: okModels.size,
    failed: failedModels.length,
    results,
    actions,
    reason: reasonText(reason),
  };
}

let probeTimer: NodeJS.Timeout | null = null;
let firstRunTimer: NodeJS.Timeout | null = null;

/** 启动周期体检：首次延后 90s（避开启动风暴），之后每 30min 一次 */
export function startModelProbeHealthLoop(intervalMs = config.modelProbeIntervalMs): void {
  if (!config.modelProbeEnabled) return;
  if (probeTimer) return;
  const run = (): void => {
    void runModelHealthCheck().then(
      (report) =>
        console.log(
          `[model-probe] ${report.ok}/${report.total} 可用，切换=${report.actions.routesPromoted} 恢复=${report.actions.routesRestored}（${report.reason}）`,
        ),
      (err) => console.warn('[model-probe] 体检失败:', (err as Error).message),
    );
  };
  firstRunTimer = setTimeout(run, 90_000);
  firstRunTimer.unref();
  probeTimer = setInterval(run, Math.max(60_000, intervalMs));
  probeTimer.unref();
}

export function stopModelProbeHealthLoop(): void {
  if (probeTimer) clearInterval(probeTimer);
  if (firstRunTimer) clearTimeout(firstRunTimer);
  probeTimer = null;
  firstRunTimer = null;
}
