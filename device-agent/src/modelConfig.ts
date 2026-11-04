import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentType } from '@agentfleet/shared';

/**
 * 一键配置模型（免登录激活）：给设备上的 codex / claude 写自定义模型配置，
 * 指向 OpenAI/Anthropic 兼容网关（默认内置 modelgateway，其 /v1/responses 已做
 * responses → chat.completions 转换，转发到等级优的免费源 kilo）。
 *
 * 这样 codex/claude 无需登录 OpenAI/Anthropic 账号，直接走免费源跑任务。
 */

/** 模型配置输入 */
export interface ModelConfigInput {
  agentType: AgentType;
  /** OpenAI/Anthropic 兼容 base_url（含 /v1） */
  baseUrl: string;
  /** 模型名（如 kilo-auto/free） */
  model: string;
  /** API key（免费源可为占位非空值，如 "sk-free"） */
  apiKey: string;
}

export interface ModelConfigResult {
  ok: boolean;
  agentType: AgentType;
  path: string;
  message: string;
}

/** 默认 modelgateway 地址（设备本地；后续可经部署在设备上运行） */
export function defaultGatewayBaseUrl(): string {
  return (process.env.MODELGATEWAY_BASE_URL ?? 'http://127.0.0.1:18765/v1').replace(/\/$/, '');
}

/** 写 codex 的 ~/.codex/config.toml（model_providers 指向自定义网关） */
export function configureCodexModel(input: ModelConfigInput): ModelConfigResult {
  const dir = path.join(os.homedir(), '.codex');
  const file = path.join(dir, 'config.toml');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // codex 0.18+ 只支持 wire_api = "responses"（chat 已废弃）
    const content = [
      `model = "${input.model}"`,
      `model_provider = "agentfleet"`,
      '',
      `[model_providers.agentfleet]`,
      `name = "AgentFleet Gateway"`,
      `base_url = "${input.baseUrl}"`,
      `env_key = "AGENTFLEET_MODEL_KEY"`,
      `wire_api = "responses"`,
      '',
    ].join('\n');
    fs.writeFileSync(file, content, 'utf-8');
    return { ok: true, agentType: 'codex', path: file, message: '已写入 codex config.toml，免登录使用自定义模型' };
  } catch (err) {
    return { ok: false, agentType: 'codex', path: file, message: `写入失败: ${(err as Error).message}` };
  }
}

/** 写 claude 的 ~/.claude/settings.json（env 注入自定义 base_url + key） */
export function configureClaudeModel(input: ModelConfigInput): ModelConfigResult {
  const dir = path.join(os.homedir(), '.claude');
  const file = path.join(dir, 'settings.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
    let prev: Record<string, unknown> = {};
    try {
      prev = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      /* 无旧配置 */
    }
    const next = {
      ...prev,
      env: {
        ...((prev.env as Record<string, unknown>) ?? {}),
        ANTHROPIC_BASE_URL: `${input.baseUrl.replace(/\/v1$/, '')}`,
        ANTHROPIC_AUTH_TOKEN: input.apiKey,
      },
    };
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf-8');
    return { ok: true, agentType: 'claude', path: file, message: '已写入 claude settings.json，免登录使用自定义模型' };
  } catch (err) {
    return { ok: false, agentType: 'claude', path: file, message: `写入失败: ${(err as Error).message}` };
  }
}

/** 一键配置：按平台写对应配置文件 */
export function configureModel(input: ModelConfigInput): ModelConfigResult {
  if (input.agentType === 'codex') return configureCodexModel(input);
  if (input.agentType === 'claude') return configureClaudeModel(input);
  return {
    ok: false,
    agentType: input.agentType,
    path: '',
    message: `该平台（${input.agentType}）暂不支持一键配置模型`,
  };
}
