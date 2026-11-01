import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GatewayManager 单测：验证协调器组件的状态流转。
 * 通过 mock child_process.spawn 与 modelGatewayClient.health 避免真实 npm build 与子进程，
 * 通过 mock global.fetch 固定 /health 的 providerCount/version。
 * 注意：GatewayManager 是全局单例，测试按顺序依赖其内部状态演进。
 */

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../src/services/routing/modelGatewayClient.js', () => ({
  modelGatewayClient: {
    health: (...args: unknown[]) => mocks.health(...args),
    isConfigured: () => true,
    isAvailable: () => true,
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mocks.spawn(...args),
}));

import { gatewayManager } from '../src/services/gateway/gatewayManager.js';

/** 构造一个可被 runSpawn/start 消费的假子进程 */
function fakeChild(opts: { pid?: number; exitCode?: number } = {}) {
  const pid = opts.pid ?? 99999;
  const child: {
    pid: number | undefined;
    exitCode: number | null;
    signalCode: string | null;
    stdout: { on: () => unknown };
    stderr: { on: () => unknown };
    on: (ev: string, cb: (...args: never[]) => void) => unknown;
  } = {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: { on: () => child },
    stderr: { on: () => child },
    on: (ev: string, cb: (...args: never[]) => void) => {
      // build 的 runSpawn 依赖 'close' 事件
      if (ev === 'close') queueMicrotask(() => cb(opts.exitCode ?? 0));
      return child;
    },
  };
  return child;
}

beforeEach(() => {
  mocks.health.mockReset();
  mocks.spawn.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '9.9.9', providers: [{}, {}, {}] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GatewayManager 状态机', () => {
  it('初始态：stopped / pid=null / built=false / healthy=false', () => {
    expect(gatewayManager.getStatus()).toEqual({
      state: 'stopped',
      pid: null,
      built: false,
      healthy: false,
      providerCount: 0,
      version: '0.1.0',
      lastError: null,
    });
  });

  it('stop() 在 stopped 态幂等返回', async () => {
    const status = await gatewayManager.stop();
    expect(status).toMatchObject({ state: 'stopped', pid: null, healthy: false });
  });

  it('build() 成功 → built=true（healthy 仍 false，state 保持 stopped）', async () => {
    mocks.spawn.mockImplementation(() => fakeChild({ exitCode: 0 }));
    const status = await gatewayManager.build();
    expect(mocks.spawn).toHaveBeenCalled();
    expect(status.built).toBe(true);
    expect(status.state).toBe('stopped');
    expect(status.lastError).toBeNull();
  });

  it('build() 失败 → state=failed, built=false, lastError 记录退出码', async () => {
    mocks.spawn.mockImplementation(() => fakeChild({ exitCode: 1 }));
    const status = await gatewayManager.build();
    expect(status.built).toBe(false);
    expect(status.state).toBe('failed');
    expect(status.lastError).toContain('exited with code 1');
  });

  it('stop() 重置后 start() 成功 → state=running, pid 记录, healthy=true, 刷新 providerCount/version', async () => {
    await gatewayManager.stop();
    mocks.health.mockResolvedValue(true);
    mocks.spawn.mockImplementation(() => fakeChild({ pid: 77777 }));
    const status = await gatewayManager.start();
    expect(status).toMatchObject({ state: 'running', pid: 77777, healthy: true });
    expect(status.providerCount).toBe(3);
    expect(status.version).toBe('9.9.9');
  });

  it('stop() 停止运行中的组件 → state=stopped, pid=null', async () => {
    const status = await gatewayManager.stop();
    expect(status).toMatchObject({ state: 'stopped', pid: null, healthy: false });
  });
});
