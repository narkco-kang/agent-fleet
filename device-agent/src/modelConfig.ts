import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentType } from '@agentfleet/shared';
import { findPlatformDef, type ModelConfigSpec } from './adapters/platformCatalog.js';

/**
 * 一键配置模型（免登录激活）：数据驱动，对齐 EchoBird 的 config.json write 映射。
 *
 * 每个平台的「模型配置写到哪里、什么格式、字段怎么映射」由 platformCatalog 的
 * modelConfig 声明（configFile + format + write），不再为单个平台写死 if/else。
 * 新增平台只需在目录加一条 modelConfig 声明即可，无需改本文件。
 *
 * 关键事实（实机验证）：新版 codex 只支持 Responses API（wire_api="responses"），
 * 而 kilo 免费源原生提供 /responses 端点且无需 key —— 所以 codex 直接配 kilo 即可
 * 免登录跑任务，无需任何中间网关/转换层。
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

/** 设备本地 modelgateway 地址（随 device-agent 部署，提供 /v1/messages anthropic→chat 与 /v1/responses 转换） */
export function defaultGatewayBaseUrl(): string {
  return (process.env.MODELGATEWAY_BASE_URL ?? 'http://127.0.0.1:18765').replace(/\/$/, '');
}

/** 占位符上下文 */
interface ExpandCtx {
  model: string;
  baseUrl: string;
  apiKey: string;
  gatewayUrl: string;
}

/**
 * 展开单个值模板。
 * 占位符：{model} / {baseUrl} / {apiKey} / {gatewayUrl}。
 * {apiKey} 空时展开为 'sk-free'（免费源占位，避免某些 CLI 因空 key 启动失败）。
 * {apiKey?} 为「可选环境变量注入」：有 apiKey 时展开为 AGENTFLEET_MODEL_KEY（codex 的 env_key
 * 指向环境变量名），无 apiKey 时返回 null（整条跳过，不写 env_key——写了会让 codex 带假
 * Authorization → 上游 401）。
 */
function expandValue(template: string, ctx: ExpandCtx): string | null {
  if (template === '{apiKey?}') {
    return ctx.apiKey ? 'AGENTFLEET_MODEL_KEY' : null;
  }
  return template
    .replaceAll('{model}', ctx.model)
    .replaceAll('{baseUrl}', ctx.baseUrl)
    .replaceAll('{gatewayUrl}', ctx.gatewayUrl)
    .replaceAll('{apiKey}', ctx.apiKey || 'sk-free');
}

/** 展开整个 write 映射（跳过展开为 null 的条目） */
function expandWrite(write: Record<string, string>, ctx: ExpandCtx): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(write)) {
    const expanded = expandValue(v, ctx);
    if (expanded !== null) out[k] = expanded;
  }
  return out;
}

/** 点分路径 set_nested_value（如 "env.ANTHROPIC_MODEL" → { env: { ANTHROPIC_MODEL: ... } }） */
function setNestedValue(obj: Record<string, unknown>, dottedPath: string, value: string): void {
  const parts = dottedPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cur[k];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** JSON 配置写入：读旧配置合并（保留用户其它设置），点分路径写入 */
function applyJson(configFile: string, write: Record<string, string>): void {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    /* 无旧配置 */
  }
  for (const [jsonPath, value] of Object.entries(write)) {
    setNestedValue(config, jsonPath, value);
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

/** TOML 配置写入：点分路径 → [table] 结构，全量生成（我们托管该配置） */
function applyToml(configFile: string, write: Record<string, string>): void {
  const topLevel: string[] = [];
  const tables = new Map<string, string[]>();
  for (const [tomlPath, value] of Object.entries(write)) {
    const parts = tomlPath.split('.');
    if (parts.length === 1) {
      topLevel.push(`${tomlPath} = ${quoteToml(value)}`);
    } else {
      const key = parts[parts.length - 1];
      const tablePath = parts.slice(0, -1).join('.');
      const arr = tables.get(tablePath) ?? [];
      arr.push(`${key} = ${quoteToml(value)}`);
      tables.set(tablePath, arr);
    }
  }
  const lines: string[] = [...topLevel];
  for (const [tablePath, entries] of tables) {
    lines.push('');
    lines.push(`[${tablePath}]`);
    lines.push(...entries);
  }
  fs.writeFileSync(configFile, lines.join('\n') + '\n', 'utf-8');
}

/** TOML 基本字符串引号（JSON 字符串与之等价，够用） */
function quoteToml(s: string): string {
  return JSON.stringify(s);
}

/** 一键配置：查平台目录的 modelConfig 声明，数据驱动写入（对齐 EchoBird 通用配置应用引擎） */
export function configureModel(input: ModelConfigInput): ModelConfigResult {
  const def = findPlatformDef(input.agentType);
  const spec: ModelConfigSpec | undefined = def?.modelConfig;
  if (!spec) {
    return {
      ok: false,
      agentType: input.agentType,
      path: '',
      message: `该平台（${input.agentType}）暂不支持一键配置模型`,
    };
  }

  const file = path.join(os.homedir(), spec.configFile);
  const ctx: ExpandCtx = {
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    gatewayUrl: defaultGatewayBaseUrl(),
  };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const write = expandWrite(spec.write, ctx);
    if (spec.format === 'json') applyJson(file, write);
    else applyToml(file, write);
    return {
      ok: true,
      agentType: input.agentType,
      path: file,
      message: `已写入 ${def?.displayName ?? input.agentType} 配置，免登录使用免费源`,
    };
  } catch (err) {
    return {
      ok: false,
      agentType: input.agentType,
      path: file,
      message: `写入失败: ${(err as Error).message}`,
    };
  }
}
