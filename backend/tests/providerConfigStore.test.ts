import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listPaidProviders,
  paidProviderConfigStatus,
  providerConfigPath,
  savePaidProviders,
} from '../src/services/gateway/providerConfigStore.js';

let hadOriginal = false;
let original = '';

beforeAll(() => {
  hadOriginal = fs.existsSync(providerConfigPath);
  if (hadOriginal) original = fs.readFileSync(providerConfigPath, 'utf8');
});

afterAll(() => {
  fs.mkdirSync(path.dirname(providerConfigPath), { recursive: true });
  if (hadOriginal) {
    fs.writeFileSync(providerConfigPath, original);
  } else if (fs.existsSync(providerConfigPath)) {
    fs.unlinkSync(providerConfigPath);
  }
});

describe('providerConfigStore', () => {
  it('保存付费 Provider 到本机配置并脱敏回显', () => {
    const providers = savePaidProviders([
      {
        id: 'DeepSeek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1/',
        apiKey: 'sk-1234567890',
        models: ['deepseek-chat', 'deepseek-reasoner'],
      },
    ]);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      hasApiKey: true,
      models: ['deepseek-chat', 'deepseek-reasoner'],
    });
    expect(providers[0].maskedApiKey).toBe('sk-1********7890');
    expect(fs.readFileSync(providerConfigPath, 'utf8')).toContain('sk-1234567890');
  });

  it('脱敏 key 提交时保留旧明文 key', () => {
    savePaidProviders([
      {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-original',
        models: ['deepseek-chat'],
      },
    ]);
    const providers = savePaidProviders([
      {
        id: 'deepseek',
        label: 'DeepSeek API',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-o********inal',
        models: ['deepseek-chat', 'deepseek-reasoner'],
      },
    ]);

    expect(providers[0].label).toBe('DeepSeek API');
    expect(fs.readFileSync(providerConfigPath, 'utf8')).toContain('sk-original');
    expect(listPaidProviders()[0].maskedApiKey).toBe('sk-o********inal');
  });

  it('暴露配置状态用于前端批量配置 UI', () => {
    const status = paidProviderConfigStatus();
    expect(status.path).toBe(providerConfigPath);
    expect(status.reloadRequired).toBe(true);
    expect(status.note).toContain('重启 modelgateway');
  });

  it('校验非法 baseUrl 与重复 id', () => {
    expect(() =>
      savePaidProviders([{ id: 'bad', baseUrl: 'not-url', models: ['m'] }]),
    ).toThrow('invalid baseUrl');
    expect(() =>
      savePaidProviders([
        { id: 'same', baseUrl: 'https://one.example/v1', models: ['m'] },
        { id: 'same', baseUrl: 'https://two.example/v1', models: ['m'] },
      ]),
    ).toThrow('duplicate provider id');
  });
});
