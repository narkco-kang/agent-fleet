import { describe, expect, it } from 'vitest';
import type { PaidProviderConfig } from '../src/config.js';
import { ProviderPool } from '../src/providers.js';

/** 构造一个付费 provider 的测试夹具 */
function paid(opts: Partial<PaidProviderConfig> = {}): PaidProviderConfig {
  return {
    id: 'paid-x',
    label: 'Paid X',
    baseUrl: 'https://paid.example.com/v1',
    apiKey: 'sk-test',
    models: ['gpt-x', 'claude-y'],
    ...opts,
  };
}

describe('ProviderPool（内置 provider 池）', () => {
  it('默认池内置 Kilo / OpenCode 两个直连免费源', () => {
    const pool = new ProviderPool();
    const list = pool.list();
    expect(list.map((p) => p.id)).toEqual(['kilo-free', 'opencode-free']);
    expect(list.map((p) => p.kind)).toEqual(['direct-free', 'direct-free']);
  });

  it('build() 合并付费 provider 与直连免费源（付费在前）', () => {
    const pool = new ProviderPool([paid()]);
    const ids = pool.list().map((p) => p.id);
    expect(ids).toEqual(['paid-x', 'kilo-free', 'opencode-free']);
    // 付费 provider 标记为 paid + bearer auth，apiKey 仅 env 注入
    expect(pool.list()[0]).toMatchObject({ kind: 'paid', auth: 'bearer', apiKey: 'sk-test' });
  });

  it('resolve 付费精确匹配（degraded=false）', () => {
    const pool = new ProviderPool([paid()]);
    const r = pool.resolve('gpt-x');
    expect(r).toMatchObject({ outModel: 'gpt-x', degraded: false });
    expect(r.provider.id).toBe('paid-x');
    expect(r.provider.kind).toBe('paid');
  });

  it('resolve 付费前缀写法 id:model 与 id/model（剥离前缀）', () => {
    const pool = new ProviderPool([paid()]);
    expect(pool.resolve('paid-x:gpt-x')).toMatchObject({ outModel: 'gpt-x', degraded: false });
    expect(pool.resolve('paid-x/claude-y').outModel).toBe('claude-y');
  });

  it('resolve 直连免费匹配（degraded=false）', () => {
    const pool = new ProviderPool();
    expect(pool.resolve('kilo-auto/free')).toMatchObject({
      provider: { id: 'kilo-free' },
      outModel: 'kilo-auto/free',
      degraded: false,
    });
    expect(pool.resolve('big-pickle').provider.id).toBe('opencode-free');
    expect(pool.resolve('beam-free').provider.id).toBe('opencode-free');
  });

  it('resolve 未命中任何 provider → 默认降级 kilo-free（degraded=true）', () => {
    const pool = new ProviderPool();
    const r = pool.resolve('some-unknown-model');
    expect(r.degraded).toBe(true);
    expect(r.provider.id).toBe('kilo-free');
    // 降级时保留原始模型名交给上游
    expect(r.outModel).toBe('some-unknown-model');
  });

  it('resolve 未命中但存在付费 provider 时仍降级到 kilo-free（免费默认源优先兜底）', () => {
    const pool = new ProviderPool([paid()]);
    const r = pool.resolve('unknown-model');
    expect(r.degraded).toBe(true);
    expect(r.provider.id).toBe('kilo-free');
  });

  it('resolve 对模型名做 trim，避免空格导致误判', () => {
    const pool = new ProviderPool([paid()]);
    expect(pool.resolve('  gpt-x  ').provider.id).toBe('paid-x');
  });

  it('health() 汇总每个 provider 的 id/label/kind/models/defaultModel', () => {
    const pool = new ProviderPool([paid()]);
    const health = pool.health();
    expect(health).toHaveLength(3);
    expect(health[0]).toMatchObject({ id: 'paid-x', kind: 'paid', defaultModel: 'gpt-x' });
    expect(health[1]).toMatchObject({ id: 'kilo-free', kind: 'direct-free', defaultModel: 'kilo-auto/free' });
    expect(health[2]).toMatchObject({ id: 'opencode-free', defaultModel: 'big-pickle' });
  });

  it('allModels() 聚合所有 provider 模型并去重', () => {
    const pool = new ProviderPool([paid({ models: ['gpt-x', 'kilo-auto/free'] })]);
    // kilo-auto/free 同时出现在付费与直连，应去重
    expect(pool.allModels()).toEqual(expect.arrayContaining(['gpt-x', 'kilo-auto/free', 'big-pickle', 'beam-free']));
    expect(new Set(pool.allModels()).size).toBe(pool.allModels().length);
  });

  it('defaultModel() 返回首个 provider 的首个模型', () => {
    expect(new ProviderPool([paid()]).defaultModel()).toBe('gpt-x');
    expect(new ProviderPool().defaultModel()).toBe('kilo-auto/free');
  });
});
