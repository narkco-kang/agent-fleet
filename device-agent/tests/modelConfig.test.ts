import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureModel } from '../src/modelConfig.js';

/**
 * 一键配置模型（免登录）：数据驱动，查平台目录 modelConfig 声明写入免费源配置。
 */

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'af-modelcfg-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const CFG = { baseUrl: 'https://api.kilo.ai/api/gateway/v1', model: 'kilo-auto/free', apiKey: '' };

describe('一键配置模型（configureModel，数据驱动）', () => {
  it('codex：写入 config.toml 含 model_providers + wire_api=responses，免费源免 key 不写 env_key', () => {
    const r = configureModel({ agentType: 'codex', ...CFG });
    expect(r.ok).toBe(true);
    const content = fs.readFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'utf-8');
    expect(content).toContain('model = "kilo-auto/free"');
    expect(content).toContain('base_url = "https://api.kilo.ai/api/gateway/v1"');
    expect(content).toContain('wire_api = "responses"');
    expect(content).toContain('[model_providers.agentfleet]');
    // 免费源免 key：不写 env_key（写了会让 codex 带假 Authorization → 401）
    expect(content).not.toContain('env_key');
  });

  it('codex：付费源（有 apiKey）才写 env_key 指向环境变量', () => {
    configureModel({ agentType: 'codex', baseUrl: 'https://paid.example/v1', model: 'gpt-x', apiKey: 'sk-real' });
    const content = fs.readFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'utf-8');
    expect(content).toContain('env_key = "AGENTFLEET_MODEL_KEY"');
  });

  it('claude：写入 settings.json，ANTHROPIC_BASE_URL 指向本地 modelgateway（anthropic 转换）', () => {
    const r = configureModel({ agentType: 'claude', ...CFG });
    expect(r.ok).toBe(true);
    const content = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8')) as {
      env: Record<string, string>;
    };
    // claude 连设备本地 modelgateway（做 anthropic→chat 转换），模型用免费源模型
    expect(content.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:18765');
    expect(content.env.ANTHROPIC_MODEL).toBe('kilo-auto/free');
  });

  it('claude：JSON 合并语义——保留 settings.json 里用户其它设置', () => {
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }));
    configureModel({ agentType: 'claude', ...CFG });
    const content = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(content.permissions).toEqual({ allow: ['Bash'] });
    expect((content.env as Record<string, string>).ANTHROPIC_MODEL).toBe('kilo-auto/free');
  });

  it('不支持的平台（无 modelConfig 声明）返回 ok=false', () => {
    const r = configureModel({ agentType: 'gemini', ...CFG });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('暂不支持');
  });
});
