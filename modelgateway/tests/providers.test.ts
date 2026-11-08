import { describe, expect, it } from 'vitest';
import { expandEnvValue, parseModelAliases, type PaidProviderConfig } from '../src/config.js';
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

describe('配置解析（密钥 env 引用 / 别名容错）', () => {
  it('expandEnvValue 展开 ${VAR} 与 $VAR，未设置返回空串，普通字符串原样保留', () => {
    process.env.AF_CONFIG_TEST_KEY = 'sk-live';
    expect(expandEnvValue('${AF_CONFIG_TEST_KEY}')).toBe('sk-live');
    expect(expandEnvValue('$AF_CONFIG_TEST_KEY')).toBe('sk-live');
    expect(expandEnvValue('${AF_CONFIG_TEST_MISSING}')).toBe('');
    expect(expandEnvValue('literal-key')).toBe('literal-key');
    delete process.env.AF_CONFIG_TEST_KEY;
  });

  it('parseModelAliases 兼容 JSON 字符串 / {aliases:{}} / 非法输入', () => {
    expect(parseModelAliases('{"a":"paid-x/gpt-x"}')).toEqual({ a: 'paid-x/gpt-x' });
    expect(parseModelAliases({ aliases: { b: 'kilo-free/kilo-auto/free' } })).toEqual({
      b: 'kilo-free/kilo-auto/free',
    });
    expect(parseModelAliases({ a: 1, '  b  ': '  paid-x/gpt-x  ' })).toEqual({ b: 'paid-x/gpt-x' });
    expect(parseModelAliases('not-json')).toEqual({});
    expect(parseModelAliases(['x'])).toEqual({});
    expect(parseModelAliases(undefined)).toEqual({});
  });
});

describe('业务模型别名（虚拟 ref → 真实上游模型）', () => {
  const aliases = {
    'mgs-claude/group/strong': 'paid-x/gpt-x',
    'mgs-hermes/group/long-context': 'kilo-free/kilo-auto/free',
    'mgs-glm/group/strong': 'claude-y',
    'mgs-tiered/group/mini-tiered': 'paid-x:claude-y',
    'broken/ref': 'no-such-provider/nope',
  };

  it('别名命中付费 provider（/ 与 : 两种前缀）→ 真实模型名、degraded=false', () => {
    const pool = new ProviderPool([paid()], aliases);
    const slash = pool.resolve('mgs-claude/group/strong');
    expect(slash).toMatchObject({ outModel: 'gpt-x', degraded: false, alias: true });
    expect(slash.provider.id).toBe('paid-x');
    expect(pool.resolve('mgs-tiered/group/mini-tiered')).toMatchObject({
      outModel: 'claude-y',
      degraded: false,
      alias: true,
    });
  });

  it('别名命中直连免费源 → kilo-free + kilo-auto/free', () => {
    const pool = new ProviderPool([paid()], aliases);
    expect(pool.resolve('mgs-hermes/group/long-context')).toMatchObject({
      provider: { id: 'kilo-free' },
      outModel: 'kilo-auto/free',
      degraded: false,
      alias: true,
    });
  });

  it('别名值只写已在册模型名 → 按模型表精确匹配到 provider', () => {
    const pool = new ProviderPool([paid()], aliases);
    expect(pool.resolve('mgs-glm/group/strong')).toMatchObject({
      provider: { id: 'paid-x' },
      outModel: 'claude-y',
      alias: true,
    });
  });

  it('别名目标解析不到 → 安全回落原降级链路，不抛错', () => {
    const pool = new ProviderPool([paid()], aliases);
    const r = pool.resolve('broken/ref');
    expect(r.degraded).toBe(true);
    expect(r.provider.id).toBe('kilo-free');
    expect(r.outModel).toBe('broken/ref');
  });

  it('未配置别名的 ref 行为不变；aliases() 只暴露映射、不含密钥', () => {
    const pool = new ProviderPool([paid()], aliases);
    expect(pool.resolve('some-unknown-model')).toMatchObject({ degraded: true, outModel: 'some-unknown-model' });
    expect(pool.aliasCount()).toBe(5);
    expect(pool.aliases()).toEqual(aliases);
    expect(JSON.stringify(pool.aliases())).not.toContain('sk-test');
  });
});
