import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { normalizeRoleRoute, roleRouteStore } from '../src/services/routing/roleRouteStore.js';
import { roleRouter } from '../src/services/routing/roleRouter.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents } from '../src/db/repo/agents.js';
import { modelGatewayClient } from '../src/services/routing/modelGatewayClient.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmesh-route-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  config.modelGatewayUrl = 'http://127.0.0.1:18765';
  modelGatewayClient.markAvailable();
  roleRouteStore.reload();
});

/** 注册一台在线设备 + grok agent */
function registerOnlineDevice(deviceId: string, agentType: 'grok' | 'codex' = 'grok'): void {
  deviceRegistry.register(deviceId, `dev-${deviceId}`, 'lan');
  upsertAgents(deviceId, [
    {
      agentType,
      displayName: agentType === 'grok' ? 'Grok' : 'Codex',
      version: '1.0.0',
      executable: agentType,
      status: 'available',
      detectMethod: 'which',
      capabilities: [],
      maxConcurrency: 1,
    },
  ]);
}

describe('roleRouteStore 导入', () => {
  it('normalizeRoleRoute 规范化对象映射条目', () => {
    const r = normalizeRoleRoute(
      { primary: 'kimi/k3', fallback: ['a', 'b'], capability: 'decision-only', bots: ['Kimi仔'] },
      'research',
    );
    expect(r).toMatchObject({
      role: 'research',
      primary: 'kimi/k3',
      fallback: ['a', 'b'],
      capability: 'decision-only',
      bots: ['Kimi仔'],
      enabled: true,
    });
  });

  it('importFromObject 支持数组与对象映射', () => {
    roleRouteStore.importFromObject([
      { role: 'r1', primary: 'p1', bots: ['b1'] },
      { role: 'r2', primary: 'p2' },
    ]);
    expect(roleRouteStore.get('r1')?.primary).toBe('p1');
    expect(roleRouteStore.get('r2')?.primary).toBe('p2');
  });
});

describe('roleRouter.decide 角色路由决策', () => {
  it('本地 agent 在线 → viaGateway=false', () => {
    registerOnlineDevice('dev-1', 'grok');
    roleRouteStore.set({
      role: 'research',
      primary: 'local',
      fallback: [],
      capability: 'chat',
      bots: ['Grok仔'],
      deviceId: 'dev-1',
      agentType: 'grok',
      enabled: true,
    });

    const d = roleRouter.decide('research');
    expect(d?.viaGateway).toBe(false);
    expect(d?.resolved.deviceId).toBe('dev-1');
    expect(d?.resolved.agentType).toBe('grok');
  });

  it('无本地绑定 → viaGateway=true（model ref）', () => {
    roleRouteStore.set({
      role: 'reasoning',
      primary: 'mgs-glm/group/strong',
      fallback: [],
      capability: 'chat',
      bots: ['Glm仔'],
      model: 'glm/strong',
      enabled: true,
    });

    const d = roleRouter.decide('reasoning');
    expect(d?.viaGateway).toBe(true);
    expect(d?.resolved.modelRef).toBe('glm/strong');
  });

  it('本地绑定离线 → 降级走网关', () => {
    registerOnlineDevice('dev-2', 'grok');
    roleRouteStore.set({
      role: 'hybrid',
      primary: 'local',
      fallback: [],
      capability: 'chat',
      bots: ['Hybrid仔'],
      deviceId: 'dev-2',
      agentType: 'grok',
      model: 'kimi/k3',
      enabled: true,
    });
    deviceRegistry.remove('dev-2'); // 离线

    const d = roleRouter.decide('hybrid');
    expect(d?.viaGateway).toBe(true);
    expect(d?.resolved.modelRef).toBe('kimi/k3');
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
    config.modelGatewayUrl = ''; // 未配置 → 不可用
    expect(roleRouter.decide('only-model')).toBeNull();
  });

  it('未知角色 → null', () => {
    expect(roleRouter.decide('not-exist')).toBeNull();
  });

  it('routesOverride（Team 复用）优先于全局表', () => {
    roleRouteStore.set({
      role: 'team-role',
      primary: 'g/global',
      fallback: [],
      capability: 'chat',
      bots: [],
      model: 'global-model',
      enabled: true,
    });
    const d = roleRouter.decide('team-role', {}, {
      'team-role': {
        role: 'team-role',
        primary: 'local',
        fallback: [],
        capability: 'chat',
        bots: [],
        deviceId: 'dev-3',
        agentType: 'codex',
        enabled: true,
      },
    });
    // dev-3 未上线 → 无本地、无网关 → null（证明 override 生效，未回退全局 model）
    expect(d).toBeNull();
  });
});
