import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureCodexModel, configureClaudeModel, configureModel } from '../src/modelConfig.js';

/**
 * 一键配置模型（免登录）：写 codex/claude 自定义模型配置，走免费源。
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

const CFG = { baseUrl: 'http://127.0.0.1:18765/v1', model: 'kilo-auto/free', apiKey: 'sk-free' };

describe('一键配置模型（configureModel）', () => {
  it('codex：写入 config.toml 含 model_providers + wire_api=responses', () => {
    const r = configureCodexModel({ agentType: 'codex', ...CFG });
    expect(r.ok).toBe(true);
    const content = fs.readFileSync(path.join(tmpHome, '.codex', 'config.toml'), 'utf-8');
    expect(content).toContain('model = "kilo-auto/free"');
    expect(content).toContain('base_url = "http://127.0.0.1:18765/v1"');
    expect(content).toContain('wire_api = "responses"');
    expect(content).toContain('[model_providers.agentfleet]');
  });

  it('claude：写入 settings.json 含 ANTHROPIC_BASE_URL', () => {
    const r = configureClaudeModel({ agentType: 'claude', ...CFG });
    expect(r.ok).toBe(true);
    const content = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf-8')) as {
      env: Record<string, string>;
    };
    expect(content.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:18765');
    expect(content.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-free');
  });

  it('不支持的平台返回 ok=false', () => {
    const r = configureModel({ agentType: 'gemini', ...CFG });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('暂不支持');
  });
});
