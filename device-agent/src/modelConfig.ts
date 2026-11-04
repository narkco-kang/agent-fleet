import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentType } from '@agentfleet/shared';

/**
 * 一键配置模型（免登录激活）：给设备上的 codex / claude 写自定义模型配置，
 * 直接指向「原生支持 Responses API 的免费源」（默认 kilo：api.kilo.ai，免 key）。
 *
 * 关键事实（实机验证）：新版 codex 只支持 Responses API（wire_api="responses"），
 * 而 kilo 免费源原生提供 /responses 端点且无需 key —— 所以 codex 直接配 kilo 即可
 * 免登录跑任务，无需任何中间网关/转换层、无需打包 modelgateway 到设备。
 */

/** 模型配置输入 */
export interface ModelConfigInput {
  agentType: AgentType;
  /** Responses API 兼容 base_url（含 /v1） */
  baseUrl: string;
  /** 模型名（如 kilo-auto/free） */
  model: string;
  /** API key（免费源无需 key 时传空字符串；付费源才需要） */
  apiKey: string;
}

export interface ModelConfigResult {
  ok: boolean;
  agentType: AgentType;
  path: string;
  message: string;
}

/** 默认免费源地址（kilo，原生 Responses API、免 key；可用 env 覆盖） */
export function defaultFreeSourceBaseUrl(): string {
  return (process.env.FREE_SOURCE_BASE_URL ?? 'https://api.kilo.ai/api/gateway/v1').replace(/\/$/, '');
}

/** 写 codex 的 ~/.codex/config.toml（model_providers 指向免费源，免 key 免登录） */
export function configureCodexModel(input: ModelConfigInput): ModelConfigResult {
  const dir = path.join(os.homedir(), '.codex');
  const file = path.join(dir, 'config.toml');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // codex 0.18+ 只支持 wire_api = "responses"（chat 已废弃）。
    // 免费源免 key：不写 env_key（写了反而会让 codex 带假 Authorization → 上游 401）。
    const lines = [
      `model = "${input.model}"`,
      `model_provider = "agentfleet"`,
      '',
      `[model_providers.agentfleet]`,
      `name = "AgentFleet Free Source"`,
      `base_url = "${input.baseUrl}"`,
      `wire_api = "responses"`,
    ];
    // 仅付费源（有 apiKey）才写 env_key
    if (input.apiKey) {
      lines.push(`env_key = "AGENTFLEET_MODEL_KEY"`);
    }
    lines.push('');
    fs.writeFileSync(file, lines.join('\n'), 'utf-8');
    return { ok: true, agentType: 'codex', path: file, message: '已写入 codex config.toml，免登录使用免费源' };
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
