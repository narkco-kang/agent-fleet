import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { initDatabase, closeDatabase, getDb } from '../src/db/database.js';
import { config } from '../src/config.js';
import { actionGuard } from '../src/services/actionGuard.js';
import { roleRouteStore } from '../src/services/routing/roleRouteStore.js';
import { roleRouter } from '../src/services/routing/roleRouter.js';
import { modelGatewayClient } from '../src/services/routing/modelGatewayClient.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents } from '../src/db/repo/agents.js';
import * as assetService from '../src/services/assets/assetService.js';
import {
  executeDelivery,
  handleAssetDeliverAck,
  listDeliveryRecords,
  registerDeliveryExecutor,
  requestDelivery,
} from '../src/services/assets/deliveryService.js';
import * as teamService from '../src/services/teams/teamService.js';
import * as loopService from '../src/services/loop/loopService.js';
import {
  LoopScheduler,
  loopScheduler,
  registerLoopExecutor,
} from '../src/services/loop/loopScheduler.js';
import {
  parseExcel,
  parseTargetsFromObjects,
} from '../src/services/deploy/excelParser.js';
import {
  clearCredentials,
  createDeployBatch,
  inMemoryCredentialCount,
  runDeploy,
} from '../src/services/deploy/deployService.js';
import type { SchedulerSubmitInput } from '../src/services/scheduler.js';
import type { LoopStep, TaskStatus } from '@agentmesh/shared';

/**
 * QA P0 集成测试 —— 路由网关融合 + 六大新功能 + 安全红线。
 * 独立于工程师自测，覆盖服务层真实 DB 交互与全局单例 wiring。
 */

let tmpDir: string;

const flush = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildXlsx(rows: Array<Record<string, string>>): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function registerAgent(deviceId: string, agentType: 'grok' | 'codex'): void {
  upsertAgents(deviceId, [
    {
      agentType,
      displayName: agentType,
      version: '1.0.0',
      executable: agentType,
      status: 'available',
      detectMethod: 'which',
      capabilities: [],
      maxConcurrency: 1,
    },
  ]);
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmesh-qa-p0-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  config.actionGuardEnabled = true;
  config.deployEnabled = true;
  config.modelGatewayUrl = 'http://127.0.0.1:18765';
  config.sshConnectTimeoutMs = 800;
  modelGatewayClient.markAvailable();
  clearCredentials();
  roleRouteStore.reload();
  // 清理全局设备注册表，避免跨测试残留
  for (const e of Array.from(deviceRegistry.all())) deviceRegistry.remove(e.deviceId);
});

afterEach(() => {
  for (const e of Array.from(deviceRegistry.all())) deviceRegistry.remove(e.deviceId);
});

// ============================================================
// A. 数据库结构 + 安全红线
// ============================================================
describe('A. 数据库结构 & 安全红线', () => {
  it('共 16 张表（基础5 + 新增11）', () => {
    const rows = getDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);
    expect(names).toHaveLength(16);
    expect(names).toEqual(
      expect.arrayContaining([
        'devices',
        'agents',
        'sessions',
        'tasks',
        'messages',
        'role_routes',
        'assets',
        'asset_deliveries',
        'teams',
        'loops',
        'deployment_batches',
        'deployment_targets',
        'action_confirmations',
        'usage_records',
        'platform_models',
        'free_checkins',
      ]),
    );
  });

  it('deployment_targets 无 password 列（密码绝不落库）', () => {
    const cols = getDb().prepare('PRAGMA table_info(deployment_targets)').all() as Array<{
      name: string;
    }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('password');
    expect(colNames).not.toContain('pwd');
    expect(colNames).toEqual(
      expect.arrayContaining([
        'target_id',
        'batch_id',
        'ip',
        'user',
        'os',
        'platforms',
        'status',
        'error',
        'created_at',
        'finished_at',
      ]),
    );
  });

  it('action_confirmations / usage_records 关键列齐全', () => {
    const ac = (getDb().prepare('PRAGMA table_info(action_confirmations)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(ac).toEqual(
      expect.arrayContaining(['confirmation_id', 'kind', 'ref_id', 'status', 'payload_summary']),
    );
    const ur = (getDb().prepare('PRAGMA table_info(usage_records)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(ur).toEqual(expect.arrayContaining(['record_id', 'provider', 'model', 'tokens_in', 'tokens_out']));
  });
});

// ============================================================
// B. actionGuard —— 三类对外动作人工确认
// ============================================================
describe('B. actionGuard 人工确认开关', () => {
  it('三类动作 request 均落库 pending_confirmation', () => {
    const d = actionGuard.request('deploy', 'ref-deploy', '部署');
    const a = actionGuard.request('asset_deliver', 'ref-asset', '分发');
    const l = actionGuard.request('loop_start', 'ref-loop', '启动');
    expect(d.kind).toBe('deploy');
    expect(a.kind).toBe('asset_deliver');
    expect(l.kind).toBe('loop_start');
    expect(d.status).toBe('pending_confirmation');
    expect(actionGuard.isConfirmed('deploy', 'ref-deploy')).toBe(false);
    expect(actionGuard.isConfirmed('asset_deliver', 'ref-asset')).toBe(false);
    expect(actionGuard.isConfirmed('loop_start', 'ref-loop')).toBe(false);
  });

  it('未确认动作被拦截（isConfirmed=false），确认后放行', () => {
    const c = actionGuard.request('deploy', 'ref-block', '拦截验证');
    expect(actionGuard.isConfirmed('deploy', 'ref-block')).toBe(false);
    const confirmed = actionGuard.confirm(c.id, 'alice');
    expect(confirmed?.status).toBe('executed');
    expect(actionGuard.isConfirmed('deploy', 'ref-block')).toBe(true);
  });

  it('reject 后 isConfirmed=false', () => {
    const c = actionGuard.request('loop_start', 'ref-reject', '拒绝');
    actionGuard.reject(c.id, 'alice');
    expect(actionGuard.get(c.id)?.status).toBe('rejected');
    expect(actionGuard.isConfirmed('loop_start', 'ref-reject')).toBe(false);
  });

  it('重复 confirm 返回 undefined（幂等防重入）', () => {
    const c = actionGuard.request('asset_deliver', 'ref-dup', '重复确认');
    expect(actionGuard.confirm(c.id, 'a')?.status).toBe('executed');
    expect(actionGuard.confirm(c.id, 'a')).toBeUndefined();
  });

  it('开关关闭时 request 自动放行（仍留审计记录）', () => {
    config.actionGuardEnabled = false;
    const c = actionGuard.request('deploy', 'ref-auto', '自动放行');
    expect(['confirmed', 'executed']).toContain(c.status);
    expect(actionGuard.isConfirmed('deploy', 'ref-auto')).toBe(true);
  });

  it('confirm 触发已注册执行器', async () => {
    let called = '';
    actionGuard.registerExecutor('deploy', (refId) => {
      called = refId;
    });
    const c = actionGuard.request('deploy', 'ref-exec', '执行器');
    actionGuard.confirm(c.id, 'alice');
    await flush();
    expect(called).toBe('ref-exec');
  });
});

// ============================================================
// C. 角色路由决策（viaGateway 二选一）
// ============================================================
describe('C. 角色路由 roleRouter.decide', () => {
  it('本地 agent 在线 → viaGateway=false（走设备）', () => {
    deviceRegistry.register('dev-local', 'Local', 'relay');
    registerAgent('dev-local', 'grok');
    roleRouteStore.set({
      role: 'research',
      primary: 'local',
      fallback: [],
      capability: 'chat',
      bots: ['Grok仔'],
      deviceId: 'dev-local',
      agentType: 'grok',
      enabled: true,
    });
    const d = roleRouter.decide('research');
    expect(d?.viaGateway).toBe(false);
    expect(d?.resolved.deviceId).toBe('dev-local');
    expect(d?.resolved.agentType).toBe('grok');
  });

  it('本地离线 + 有 model → 降级网关（fallbackLevel=1）', () => {
    // dev-hybrid 未注册（离线），但有 model 兜底
    roleRouteStore.set({
      role: 'hybrid',
      primary: 'local',
      fallback: [],
      capability: 'chat',
      bots: ['Hybrid仔'],
      deviceId: 'dev-hybrid',
      agentType: 'grok',
      model: 'kimi/k3',
      enabled: true,
    });
    const d = roleRouter.decide('hybrid');
    expect(d?.viaGateway).toBe(true);
    expect(d?.resolved.modelRef).toBe('kimi/k3');
    expect(d?.fallbackLevel).toBe(1);
  });

  it('纯模型路由（无本地绑定）→ viaGateway=true modelRef=primary', () => {
    roleRouteStore.set({
      role: 'research',
      primary: 'kimi/k3.1-pro-highspeed',
      fallback: [],
      capability: 'chat',
      bots: ['Kimi仔'],
      enabled: true,
    });
    const d = roleRouter.decide('research');
    expect(d?.viaGateway).toBe(true);
    expect(d?.resolved.modelRef).toBe('kimi/k3.1-pro-highspeed');
  });

  it('本地绑定离线且无 model → 返回 null（不回退把 primary 当模型）', () => {
    roleRouteStore.set({
      role: 'local-only',
      primary: 'some-ref',
      fallback: [],
      capability: 'chat',
      bots: [],
      deviceId: 'dev-gone',
      agentType: 'grok',
      enabled: true,
    });
    expect(roleRouter.decide('local-only')).toBeNull();
  });

  it('modelgateway 不可用 → 返回 null', () => {
    roleRouteStore.set({
      role: 'only-model',
      primary: 'mgs/group',
      fallback: [],
      capability: 'chat',
      bots: [],
      model: 'm/x',
      enabled: true,
    });
    config.modelGatewayUrl = '';
    expect(roleRouter.decide('only-model')).toBeNull();
  });

  it('未知角色 → null', () => {
    expect(roleRouter.decide('not-a-role')).toBeNull();
  });
});

// ============================================================
// D. Excel 批量部署
// ============================================================
describe('D. Excel 批量部署（密码不落库 + 回环失败优雅）', () => {
  it('解析 xlsx：有效行 + 坏行 invalidRows', () => {
    const buf = buildXlsx([
      { IP: '192.168.1.10', 账号: 'root', 密码: 'secret1', platforms: 'codex, claude' },
      { IP: '', 账号: 'root', 密码: 'x' },
      { IP: '10.0.0.1', 账号: '', 密码: 'x' },
    ]);
    const { targets, invalidRows } = parseExcel(buf);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ ip: '192.168.1.10', user: 'root', password: 'secret1' });
    expect(targets[0].platforms).toEqual(['codex', 'claude']);
    expect(invalidRows).toHaveLength(2);
    expect(invalidRows.map((r) => r.reason).sort()).toEqual(['missing ip', 'missing user']);
  });

  it('空 Excel（仅表头无数据行）→ 空 targets 不崩溃', () => {
    const buf = buildXlsx([]);
    const { targets, invalidRows } = parseExcel(buf);
    expect(targets).toHaveLength(0);
    expect(invalidRows).toHaveLength(0);
  });

  it('JSON 直传 targets 解析 + 坏行', () => {
    const { targets, invalidRows } = parseTargetsFromObjects([
      { ip: '10.0.0.3', user: 'root', password: 'pw' },
      { ip: '10.0.0.4' },
    ]);
    expect(targets).toHaveLength(1);
    expect(invalidRows).toHaveLength(1);
    expect(invalidRows[0].reason).toBe('missing user');
  });

  it('createDeployBatch：落库无密码 + 走 actionGuard + 密码仅内存', () => {
    const parsed = parseTargetsFromObjects([
      { ip: '127.0.0.1', user: 'root', password: 'hunter2' },
      { ip: '127.0.0.2', user: 'admin', password: 'hunter3' },
    ]);
    const result = createDeployBatch('qa-batch', parsed.targets, parsed.invalidRows);

    expect(result.status).toBe('pending_confirmation');
    expect(result.targets).toHaveLength(2);
    expect(result.targets.map((t) => (t as Record<string, unknown>).password)).toEqual([
      undefined,
      undefined,
    ]);

    // 密码仅内存
    expect(inMemoryCredentialCount()).toBe(2);

    // 走 actionGuard：deploy 确认记录存在且未确认
    expect(actionGuard.isConfirmed('deploy', result.batchId)).toBe(false);
    const confs = actionGuard.list({ kind: 'deploy', refId: result.batchId });
    expect(confs).toHaveLength(1);
    expect(confs[0].status).toBe('pending_confirmation');
  });

  it('deploy disabled 时 createDeployBatch 抛错', () => {
    config.deployEnabled = false;
    expect(() => createDeployBatch('x', [], [])).toThrow('deploy disabled');
  });

  it('runDeploy 127.0.0.1 回环失败优雅回落 + 密码执行后清除', async () => {
    const parsed = parseTargetsFromObjects([
      { ip: '127.0.0.1', user: 'nobody', password: 'topsecret' },
    ]);
    const result = createDeployBatch('qa-loopback', parsed.targets, parsed.invalidRows);
    expect(inMemoryCredentialCount()).toBe(1);

    // 直接触发执行（等价于 actionGuard 确认后 executor 调 runDeploy）
    const batch = await runDeploy(result.batchId);
    expect(batch).toBeDefined();
    // 终态：成功或失败（取决于本机是否有 SSH，但不崩溃、不悬挂）
    expect(['completed', 'failed']).toContain(batch?.status);
    const target = batch?.targets[0];
    expect(['success', 'failed']).toContain(target?.status);
    if (target?.status === 'failed') {
      expect(target.error).toBeTruthy();
    }

    // 安全红线：无论成败，内存密码已清除
    expect(inMemoryCredentialCount()).toBe(0);
  });
});

// ============================================================
// E. 资产 CRUD + 分发（confirm 前不下发 / 离线 pending）
// ============================================================
describe('E. 资产管理 + 分发', () => {
  it('Asset CRUD + version 递增', () => {
    const a = assetService.create({ kind: 'rule', name: '安全规则', content: 'v1' });
    expect(a.version).toBe(1);
    const updated = assetService.update(a.id, { content: 'v2', tags: ['sec'] });
    expect(updated?.version).toBe(2);
    expect(updated?.content).toBe('v2');
    expect(updated?.tags).toEqual(['sec']);
    expect(assetService.list({ kind: 'rule' }).map((x) => x.id)).toContain(a.id);
    expect(assetService.get(a.id)?.version).toBe(2);
  });

  it('非法 kind 抛错', () => {
    expect(() => assetService.create({ kind: 'bad' as never, name: 'x', content: '' })).toThrow(
      'invalid asset kind',
    );
  });

  it('confirm 前不产生任何 asset_deliver / 分发记录', async () => {
    const a = assetService.create({ kind: 'skill', name: 'skill-a', content: 'code' });
    const r = requestDelivery([a.id], ['dev-x']);
    expect(r.status).toBe('pending_confirmation');
    expect(actionGuard.isConfirmed('asset_deliver', r.deliveryId)).toBe(false);
    // 未 confirm：无分发记录
    expect(listDeliveryRecords()).toHaveLength(0);
  });

  it('confirm 后执行分发：在线走 sending、离线保持 pending', async () => {
    registerDeliveryExecutor();
    const a = assetService.create({ kind: 'knowledge', name: 'kb-a', content: 'kb' });
    // dev-online 经 relay 在线（sendToDevice 返回 true）；dev-offline 未注册
    deviceRegistry.register('dev-online', 'Online', 'relay');

    const r = requestDelivery([a.id], ['dev-online', 'dev-offline']);
    const c = actionGuard.confirm(r.confirmationId, 'qa');
    expect(c?.status).toBe('executed');
    await flush();

    const records = listDeliveryRecords();
    expect(records).toHaveLength(2);
    const online = records.find((x) => x.deviceId === 'dev-online');
    const offline = records.find((x) => x.deviceId === 'dev-offline');
    expect(online?.status).toBe('sending');
    expect(offline?.status).toBe('pending');
  });

  it('asset.deliver_ack delivered → 记录更新为 delivered', () => {
    const a = assetService.create({ kind: 'rule', name: 'rule-ack', content: 'r' });
    deviceRegistry.register('dev-ack', 'Ack', 'relay');
    const r = requestDelivery([a.id], ['dev-ack']);
    actionGuard.confirm(r.confirmationId, 'qa');
    return flush().then(() => {
      const rec = listDeliveryRecords({ deviceId: 'dev-ack' })[0];
      handleAssetDeliverAck({
        deliveryId: rec.id,
        assetId: a.id,
        deviceId: 'dev-ack',
        version: a.version,
        status: 'delivered',
      });
      expect(listDeliveryRecords({ deviceId: 'dev-ack' })[0].status).toBe('delivered');
    });
  });

  it('空 mempool：executeDelivery 未登记的 deliveryId 返回空数组', async () => {
    expect(await executeDelivery('not-exist')).toEqual([]);
  });
});

// ============================================================
// F. 专家团队（单/跨设备 + resolveTeamRoutes 复用 roleRouter）
// ============================================================
describe('F. 专家团队', () => {
  it('单设备团队创建：成员 deviceId 相同', () => {
    const team = teamService.create({
      name: '单设备团队',
      members: [
        { role: 'research', deviceId: 'dev-solo', agentType: 'grok' },
        { role: 'review', deviceId: 'dev-solo', agentType: 'codex' },
      ],
    });
    expect(team.members).toHaveLength(2);
    expect(team.members.every((m) => m.deviceId === 'dev-solo')).toBe(true);
  });

  it('跨设备团队：成员 deviceId 可空 + resolveTeamRoutes 复用 roleRouter', () => {
    deviceRegistry.register('dev-a', 'A', 'relay');
    registerAgent('dev-a', 'grok');
    registerAgent('dev-a', 'codex');
    modelGatewayClient.markAvailable();

    const team = teamService.create({
      name: '跨设备团队',
      members: [
        { role: 'research', deviceId: 'dev-a', agentType: 'grok' },
        { role: 'review', deviceId: 'dev-a', agentType: 'codex' },
        { role: 'reasoning' }, // deviceId 可空 → 走 team.routes
      ],
      routes: {
        reasoning: {
          role: 'reasoning',
          primary: 'mgs-glm/group/strong',
          fallback: [],
          capability: 'chat',
          bots: ['Glm仔'],
          model: 'glm/strong',
          enabled: true,
        },
      },
    });

    const routes = teamService.resolveTeamRoutes(team.id);
    expect(routes.research?.viaGateway).toBe(false);
    expect(routes.research?.resolved.deviceId).toBe('dev-a');
    expect(routes.review?.viaGateway).toBe(false);
    expect(routes.review?.resolved.agentType).toBe('codex');
    expect(routes.reasoning?.viaGateway).toBe(true);
    expect(routes.reasoning?.resolved.modelRef).toBe('glm/strong');
  });

  it('不存在的团队 resolveTeamRoutes 返回空对象', () => {
    expect(teamService.resolveTeamRoutes('no-such-team')).toEqual({});
  });
});

// ============================================================
// G. Loop 编排（start 需 confirm + step/round/pause/cancel）
// ============================================================
describe('G. Loop 编排', () => {
  function createLoop(steps?: LoopStep[]) {
    return loopService.create({
      name: 'qa-loop',
      steps:
        steps ??
        ([
          {
            id: 's1',
            name: 'step1',
            template: { prompt: 'p1', target: { mode: 'role', role: 'research' }, options: {} },
            dependsOn: [],
          },
          {
            id: 's2',
            name: 'step2',
            template: { prompt: 'p2', target: { mode: 'auto' }, options: {} },
            dependsOn: ['s1'],
          },
        ] as LoopStep[]),
      targets: [],
    });
  }

  it('创建 loop 初始 state=idle，currentRound=0', () => {
    const loop = createLoop();
    expect(loop.state).toBe('idle');
    expect(loop.currentRound).toBe(0);
    expect(loop.currentStepIndex).toBe(0);
    expect(loop.steps).toHaveLength(2);
  });

  it('start 需 actionGuard 确认：未确认不启动，确认后 running', async () => {
    const loop = createLoop();
    // 请求启动 → 待确认，loop 保持 idle 且未激活
    const c = actionGuard.request('loop_start', loop.id, `Loop 启动：${loop.name}`);
    expect(c.status).toBe('pending_confirmation');
    expect(loopService.get(loop.id)?.state).toBe('idle');
    expect(loopScheduler.isActive(loop.id)).toBe(false);

    // 注册执行器后确认 → 触发 loopScheduler.start
    registerLoopExecutor();
    const confirmed = actionGuard.confirm(c.id, 'qa');
    expect(confirmed?.status).toBe('executed');
    await flush();

    expect(loopScheduler.isActive(loop.id)).toBe(true);
    expect(loopService.get(loop.id)?.state).toBe('running');

    // 清理
    loopScheduler.cancel(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('cancelled');
  });

  it('scheduler：step 推进 → round+1 → pause/cancel', () => {
    const loop = createLoop();
    const taskStatuses = new Map<string, TaskStatus>();
    const enqueued: Array<{ prompt: string; mode: string; role?: string }> = [];
    let seq = 0;
    const scheduler = new LoopScheduler({
      enqueueTask: (input: SchedulerSubmitInput) => {
        const taskId = `t${++seq}`;
        enqueued.push({ prompt: input.prompt, mode: input.targetMode, role: input.targetRole });
        taskStatuses.set(taskId, 'queued');
        return taskId;
      },
      getTaskStatus: (taskId) => taskStatuses.get(taskId),
    });

    expect(scheduler.start(loop.id)).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ prompt: 'p1', mode: 'role', role: 'research' });

    // s1 完成 → 推进，入队 s2
    taskStatuses.set('t1', 'completed');
    scheduler.tick();
    scheduler.tick();
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1].prompt).toBe('p2');

    // s2 完成 → index 越界 → 下一 tick round+1
    taskStatuses.set('t2', 'completed');
    scheduler.tick();
    expect(loopService.get(loop.id)?.currentStepIndex).toBe(2);
    scheduler.tick();
    expect(loopService.get(loop.id)?.currentRound).toBe(1);
    expect(loopService.get(loop.id)?.currentStepIndex).toBe(0);

    // pause/cancel
    scheduler.pause(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('paused');
    scheduler.cancel(loop.id);
    expect(loopService.get(loop.id)?.state).toBe('cancelled');
    expect(scheduler.isActive(loop.id)).toBe(false);
  });

  it('step 失败 → loop failed', () => {
    const loop = createLoop();
    const taskStatuses = new Map<string, TaskStatus>();
    const scheduler = new LoopScheduler({
      enqueueTask: () => {
        taskStatuses.set('t1', 'queued');
        return 't1';
      },
      getTaskStatus: (taskId) => taskStatuses.get(taskId),
    });
    scheduler.start(loop.id);
    taskStatuses.set('t1', 'failed');
    scheduler.tick();
    expect(loopService.get(loop.id)?.state).toBe('failed');
    expect(scheduler.isActive(loop.id)).toBe(false);
  });
});
