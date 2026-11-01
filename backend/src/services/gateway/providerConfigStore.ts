import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 付费 Provider 本机配置仓库。
 *
 * 安全约束：
 * - API Key 仅保存到本机 .workbuddy-ai/modelgateway-providers.json（仓库已 gitignore）。
 * - 对前端读取时默认脱敏；只有写入接口接收明文。
 * - 保存后 chmod 600（best effort）。
 */

export interface PaidProviderInput {
  id: string;
  label?: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface StoredPaidProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  updatedAt: number;
}

export interface PublicPaidProvider {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  hasApiKey: boolean;
  maskedApiKey: string;
  updatedAt: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..', '..', '..');
export const providerConfigPath = path.join(rootDir, '.workbuddy-ai', 'modelgateway-providers.json');

function normalizeId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '');
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}********${key.slice(-4)}`;
}

function parseStored(raw: unknown): StoredPaidProvider[] {
  const arr = Array.isArray(raw) ? raw : (raw as { providers?: unknown[] })?.providers;
  if (!Array.isArray(arr)) return [];
  const out: StoredPaidProvider[] = [];
  for (const item of arr) {
    const p = item as Partial<StoredPaidProvider>;
    if (!p || typeof p.id !== 'string' || typeof p.baseUrl !== 'string') continue;
    const id = normalizeId(p.id);
    const models = Array.isArray(p.models) ? p.models.filter((m): m is string => typeof m === 'string' && m.trim() !== '') : [];
    if (!id || models.length === 0) continue;
    out.push({
      id,
      label: typeof p.label === 'string' && p.label.trim() ? p.label.trim() : id,
      baseUrl: normalizeBaseUrl(p.baseUrl),
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      models,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : Date.now(),
    });
  }
  return out;
}

export function readPaidProviders(): StoredPaidProvider[] {
  try {
    if (!fs.existsSync(providerConfigPath)) return [];
    const raw = JSON.parse(fs.readFileSync(providerConfigPath, 'utf8')) as unknown;
    return parseStored(raw);
  } catch {
    return [];
  }
}

export function listPaidProviders(): PublicPaidProvider[] {
  return readPaidProviders().map((p) => ({
    id: p.id,
    label: p.label,
    baseUrl: p.baseUrl,
    models: p.models,
    hasApiKey: Boolean(p.apiKey),
    maskedApiKey: maskKey(p.apiKey),
    updatedAt: p.updatedAt,
  }));
}

export function savePaidProviders(inputs: PaidProviderInput[]): PublicPaidProvider[] {
  if (!Array.isArray(inputs)) throw new Error('providers must be an array');
  const previous = new Map(readPaidProviders().map((p) => [p.id, p]));
  const next: StoredPaidProvider[] = [];
  const seen = new Set<string>();
  const now = Date.now();

  for (const input of inputs) {
    const id = normalizeId(String(input.id ?? ''));
    if (!id) throw new Error('provider id required');
    if (seen.has(id)) throw new Error(`duplicate provider id: ${id}`);
    seen.add(id);

    const baseUrl = normalizeBaseUrl(String(input.baseUrl ?? ''));
    if (!/^https?:\/\//.test(baseUrl)) throw new Error(`invalid baseUrl for ${id}`);

    const models = Array.isArray(input.models)
      ? input.models.map((m) => String(m).trim()).filter(Boolean)
      : [];
    if (models.length === 0) throw new Error(`models required for ${id}`);

    const prev = previous.get(id);
    const rawKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : undefined;
    const apiKey = rawKey && !rawKey.includes('********') ? rawKey : prev?.apiKey ?? '';

    next.push({
      id,
      label: input.label?.trim() || id,
      baseUrl,
      apiKey,
      models,
      updatedAt: now,
    });
  }

  fs.mkdirSync(path.dirname(providerConfigPath), { recursive: true });
  fs.writeFileSync(providerConfigPath, JSON.stringify({ providers: next }, null, 2));
  try {
    fs.chmodSync(providerConfigPath, 0o600);
  } catch {
    // Windows 或受限文件系统可能不支持 chmod，忽略。
  }
  return listPaidProviders();
}

export function paidProviderConfigStatus() {
  return {
    path: providerConfigPath,
    providers: listPaidProviders(),
    reloadRequired: true,
    note: '保存后请重启 modelgateway，使新的付费 Provider 配置生效。',
  };
}
