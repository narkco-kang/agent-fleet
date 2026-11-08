import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// cjs 打包产物里有模块级 __dirname；源码 tsx 运行则用 import.meta.url。二者取其一，避免 TDZ。
const dirName = typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
// modelgateway/src -> modelgateway -> monorepo 根（打包后该路径可能不存在，readFile 会容错返回 []）
const rootDir = path.resolve(dirName, '..', '..');
const providerConfigPath = path.join(rootDir, '.workbuddy-ai', 'modelgateway-providers.json');
// 别名单独存放：backend 的 savePaidProviders() 会整体重写 provider 配置文件，混写会被覆盖。
const aliasConfigPath = path.join(rootDir, '.workbuddy-ai', 'modelgateway-aliases.json');

dotenv.config({ path: path.join(rootDir, '.env') });

/** 付费 provider（env 或本机 .workbuddy-ai 配置；apiKey 不落仓库/不明文回显） */
export interface PaidProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

/**
 * 业务模型 ref → 真实上游模型。
 * 值支持三种写法：`providerId/model` / `providerId:model` / 已在册的模型名。
 * 解决「角色路由里是 DSH 风格虚拟 ref，上游却不认这些名字」的脱节问题。
 */
export type ModelAliasMap = Record<string, string>;

export interface GatewayConfig {
  port: number;
  host: string;
  paidProviders: PaidProviderConfig[];
  modelAliases: ModelAliasMap;
}

/** `${ENV_VAR}` / `$ENV_VAR` 引用展开：密钥只从环境注入，不落本机配置文件 */
export function expandEnvValue(raw: string): string {
  const value = raw.trim();
  const match =
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value) ??
    /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
  return match ? (process.env[match[1]] ?? '') : raw;
}

/** 解析 MG_PAID_PROVIDERS 或本机配置文件（JSON 数组 / {providers:[]}），容错非法输入 */
function parsePaidProviders(raw: unknown): PaidProviderConfig[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim() || raw.trim() === '[]') return [];
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  const out: PaidProviderConfig[] = [];
  for (const item of list) {
    const p = item as Partial<PaidProviderConfig> | null;
    if (!p || typeof p.id !== 'string' || typeof p.baseUrl !== 'string') continue;
    out.push({
      id: p.id,
      label: typeof p.label === 'string' ? p.label : p.id,
      baseUrl: p.baseUrl,
      apiKey: expandEnvValue(typeof p.apiKey === 'string' ? p.apiKey : ''),
      models: Array.isArray(p.models) ? p.models.filter((m): m is string => typeof m === 'string') : [],
    });
  }
  return out;
}

/** 解析 MG_MODEL_ALIASES 或别名文件（JSON object / {aliases:{}}），容错非法输入 */
export function parseModelAliases(raw: unknown): ModelAliasMap {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const wrapper = parsed as { aliases?: unknown };
  const source = wrapper.aliases !== undefined ? wrapper.aliases : parsed;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const out: ModelAliasMap = {};
  for (const [ref, target] of Object.entries(source as Record<string, unknown>)) {
    if (!ref.trim() || typeof target !== 'string' || !target.trim()) continue;
    out[ref.trim()] = target.trim();
  }
  return out;
}

function readJsonFile(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) return undefined;
    return JSON.parse(fs.readFileSync(pathname, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function mergePaidProviders(envProviders: PaidProviderConfig[], fileProviders: PaidProviderConfig[]): PaidProviderConfig[] {
  const byId = new Map<string, PaidProviderConfig>();
  for (const p of fileProviders) byId.set(p.id, p);
  // 环境变量优先级更高，适合 CI/容器和高级用户覆盖 UI 配置。
  for (const p of envProviders) byId.set(p.id, p);
  return Array.from(byId.values());
}

// CI / 集成测试可用 MODELGATEWAY_LOCAL_CONFIG=0 彻底隔离本机配置文件，
// 否则本机付费 provider 与别名会污染「无付费 provider」的冒烟断言。
const localConfigEnabled = process.env.MODELGATEWAY_LOCAL_CONFIG !== '0';

export const config: GatewayConfig = {
  port: Number(process.env.MODELGATEWAY_PORT ?? 18765),
  host: process.env.MODELGATEWAY_HOST ?? '127.0.0.1',
  paidProviders: mergePaidProviders(
    parsePaidProviders(process.env.MG_PAID_PROVIDERS),
    parsePaidProviders(localConfigEnabled ? readJsonFile(providerConfigPath) : undefined),
  ),
  modelAliases: {
    ...(localConfigEnabled ? parseModelAliases(readJsonFile(aliasConfigPath)) : {}),
    // env 覆盖同名别名，便于临时故障注入 / CI 验证，无需改文件
    ...parseModelAliases(process.env.MG_MODEL_ALIASES),
  },
};
