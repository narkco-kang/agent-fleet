import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FreeSourceRating } from '@agentfleet/shared';
import { initDatabase, closeDatabase, getDb } from '../src/db/database.js';
import { config } from '../src/config.js';
import { healthBoard } from '../src/services/healthBoard.js';
import { roleRouteStore } from '../src/services/routing/roleRouteStore.js';
import * as platformModelService from '../src/services/routing/platformModelService.js';
import type { ModelProbeResult } from '../src/services/routing/modelGatewayClient.js';
import {
  collectActiveModelRefs,
  listProbeResults,
  runModelHealthCheck,
} from '../src/services/routing/modelProbeHealth.js';

/**
 * DSH 融合：模型真实推理体检闭环（docs/29）。
 * 探测结论必须写回路由决策，且不能把网关故障误判成「所有模型都坏了」。
 */
let tmpDir: string;
const GATEWAY_URL = 'http://127.0.0.1:18765';

function result(model: string, ok: boolean): ModelProbeResult {
  const rating: FreeSourceRating = ok ? 'excellent' : 'poor';
  return {
    model,
    ok,
    latencyMs: ok ? 12 : 0,
    error: ok ? undefined : 'inference unavailable',
    needsCheckin: false,
    checkinAttempted: false,
    rating,
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-probe-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  config.modelGatewayUrl = GATEWAY_URL;
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  for (const table of ['role_routes', 'platform_models', 'model_probe_results', 'model_probe_actions']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  roleRouteStore.reload();
  healthBoard.reset();
  config.modelGatewayUrl = GATEWAY_URL;
});

describe('模型真实推理体检闭环', () => {
  it('collectActiveModelRefs 汇总角色路由与平台绑定的全部在用 ref 并去重', () => {
    roleRouteStore.set({
      role: 'r1', primary: 'bad/model', fallback: ['good/model'],
      capability: 'chat', bots: [], enabled: true,
    });
    platformModelService.bind('dev-1', 'claude', 'bad/model', ['good/model']);
    expect(collectActiveModelRefs().sort()).toEqual(['bad/model', 'good/model']);
  });

  it('失败模型 → 平台绑定切兜底 + 角色路由 promote；结果落盘可审计', async () => {
    roleRouteStore.set({
      role: 'r1', primary: 'bad/model', fallback: ['good/model'],
      capability: 'chat', bots: [], enabled: true,
    });
    platformModelService.bind('dev-1', 'claude', 'bad/model', ['good/model']);

    const report = await runModelHealthCheck(async (models) =>
      models.map((m) => result(m, m === 'good/model')),
    );

    expect(report.total).toBe(2);
    expect(report.ok).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.actions.routesPromoted).toBe(1);
    expect(report.actions.bindingsSwitched).toBe(1);
    expect(roleRouteStore.get('r1')?.primary).toBe('good/model');
    expect(platformModelService.list()[0]?.activeModel).toBe('good/model');
    expect(listProbeResults().find((r) => r.model === 'bad/model')?.ok).toBe(false);
  });

  it('模型恢复 → 依据持久记录精确复原路由 + 清掉平台绑定排除表', async () => {
    roleRouteStore.set({
      role: 'r1', primary: 'bad/model', fallback: ['good/model'],
      capability: 'chat', bots: [], enabled: true,
    });
    platformModelService.bind('dev-1', 'claude', 'bad/model', ['good/model']);

    await runModelHealthCheck(async (models) => models.map((m) => result(m, m === 'good/model')));
    const report = await runModelHealthCheck(async (models) => models.map((m) => result(m, true)));

    expect(report.actions.routesRestored).toBe(1);
    expect(roleRouteStore.get('r1')?.primary).toBe('bad/model');
    expect(roleRouteStore.get('r1')?.enabled).not.toBe(false);
    expect(platformModelService.list()[0]?.excluded).toEqual([]);
    expect(report.actions.bindingsRecovered).toBe(1);
  });

  it('无可用兜底 → 禁用该角色路由，恢复后自动重新启用', async () => {
    roleRouteStore.set({
      role: 'solo', primary: 'solo/model', fallback: [],
      capability: 'chat', bots: [], enabled: true,
    });
    const first = await runModelHealthCheck(async (models) => models.map((m) => result(m, false)));
    // 只有一个 ref 且失败 → 判定基础设施故障，不做破坏性清理
    expect(first.infrastructureFailure).toBe(true);
    expect(roleRouteStore.get('solo')?.enabled).not.toBe(false);

    // 加入一个健康模型，让「至少一个成功」成立，才能确认是 solo/model 自身坏了
    roleRouteStore.set({
      role: 'healthy', primary: 'healthy/model', fallback: [],
      capability: 'chat', bots: [], enabled: true,
    });
    const second = await runModelHealthCheck(async (models) =>
      models.map((m) => result(m, m === 'healthy/model')),
    );
    expect(second.infrastructureFailure).toBe(false);
    expect(second.actions.routesDisabled).toBe(1);
    expect(roleRouteStore.get('solo')?.enabled).toBe(false);

    const third = await runModelHealthCheck(async (models) => models.map((m) => result(m, true)));
    expect(third.actions.routesRestored).toBe(1);
    expect(roleRouteStore.get('solo')?.enabled).toBe(true);
    expect(roleRouteStore.get('solo')?.primary).toBe('solo/model');
  });

  it('全部探测失败 = 基础设施故障：只记 health，绝不清空路由（安全护栏）', async () => {
    roleRouteStore.set({
      role: 'r1', primary: 'm1', fallback: ['m2'],
      capability: 'chat', bots: [], enabled: true,
    });
    const report = await runModelHealthCheck(async (models) => models.map((m) => result(m, false)));
    expect(report.infrastructureFailure).toBe(true);
    expect(report.actions.routesPromoted).toBe(0);
    expect(report.actions.routesDisabled).toBe(0);
    expect(roleRouteStore.get('r1')?.primary).toBe('m1');
    expect(healthBoard.get('model-probe')?.state).toBe('degraded');
  });

  it('modelgateway 未配置 → 直接返回，不发起探测、不做任何清理', async () => {
    config.modelGatewayUrl = '';
    let probed = false;
    const report = await runModelHealthCheck(async () => {
      probed = true;
      return [];
    });
    expect(probed).toBe(false);
    expect(report.configured).toBe(false);
    expect(report.total).toBe(0);
    expect(listProbeResults()).toHaveLength(0);
  });
});
