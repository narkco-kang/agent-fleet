import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// modelgateway/src -> modelgateway -> monorepo 根
const rootDir = path.resolve(__dirname, '..', '..');
const providerConfigPath = path.join(rootDir, '.workbuddy-ai', 'modelgateway-providers.json');

dotenv.config({ path: path.join(rootDir, '.env') });

/** 付费 provider（env 或本机 .workbuddy-ai 配置；apiKey 不落仓库/不明文回显） */
export interface PaidProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface GatewayConfig {
  port: number;
  host: string;
  paidProviders: PaidProviderConfig[];
}

/** 解析 MG_PAID_PROVIDERS 或本机配置文件（JSON 数组 / {providers:[]}），容错非法输入 */
function parsePaidProviders(raw: string | undefined): PaidProviderConfig[] {
  if (!raw || !raw.trim() || raw.trim() === '[]') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { providers?: unknown[] })?.providers;
    if (!Array.isArray(list)) return [];
    const out: PaidProviderConfig[] = [];
    for (const item of list) {
      const p = item as Partial<PaidProviderConfig>;
      if (!p || typeof p.id !== 'string' || typeof p.baseUrl !== 'string') continue;
      out.push({
        id: p.id,
        label: typeof p.label === 'string' ? p.label : p.id,
        baseUrl: p.baseUrl,
        apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
        models: Array.isArray(p.models) ? p.models.filter((m): m is string => typeof m === 'string') : [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

function readFilePaidProviders(): PaidProviderConfig[] {
  try {
    if (!fs.existsSync(providerConfigPath)) return [];
    return parsePaidProviders(fs.readFileSync(providerConfigPath, 'utf8'));
  } catch {
    return [];
  }
}

function mergePaidProviders(envProviders: PaidProviderConfig[], fileProviders: PaidProviderConfig[]): PaidProviderConfig[] {
  const byId = new Map<string, PaidProviderConfig>();
  for (const p of fileProviders) byId.set(p.id, p);
  // 环境变量优先级更高，适合 CI/容器和高级用户覆盖 UI 配置。
  for (const p of envProviders) byId.set(p.id, p);
  return Array.from(byId.values());
}

export const config: GatewayConfig = {
  port: Number(process.env.MODELGATEWAY_PORT ?? 18765),
  host: process.env.MODELGATEWAY_HOST ?? '127.0.0.1',
  paidProviders: mergePaidProviders(parsePaidProviders(process.env.MG_PAID_PROVIDERS), readFilePaidProviders()),
};
