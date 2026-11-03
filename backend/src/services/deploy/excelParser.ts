import * as XLSX from 'xlsx';
import type { AgentType, PlatformModelConfig } from '@agentfleet/shared';
import { AGENT_TYPES } from '@agentfleet/shared';

/**
 * Excel 解析（F1）：读取 .xlsx/.csv → 提取 IP / 账号 / 密码 / 平台。
 * 密码只进入内存 DeploymentCredential（由 deployService 持有），绝不落库。
 */

/** 解析后的单行目标（含内存密码） */
export interface ParsedTarget {
  ip: string;
  user: string;
  password?: string;
  /** SSH 端口（默认 22） */
  port?: number;
  /** 可选：已注册 AgentFleet 设备 id，部署成功后据此绑定模型 */
  deviceId?: string;
  platforms: AgentType[];
  /** 部署成功后为各平台绑定的网关模型 */
  modelConfigs?: PlatformModelConfig[];
}

export interface ParseResult {
  targets: ParsedTarget[];
  invalidRows: Array<{ row: number; reason: string }>;
}

/** 表头别名（大小写/空格不敏感，归一化后匹配） */
const IP_ALIASES = ['ip', 'ip地址', 'ipaddress', 'host', 'hostname', '主机', '地址', '设备ip'];
const USER_ALIASES = ['user', 'username', 'account', '账号', '用户名', '用户'];
const PASSWORD_ALIASES = ['password', 'passwd', 'pwd', '密码', '口令'];
const PLATFORM_ALIASES = ['platforms', 'platform', 'agents', 'agent', '平台', '组件'];
const PORT_ALIASES = ['port', 'sshport', 'ssh_port', '端口', 'ssh端口'];
const DEVICE_ALIASES = ['deviceid', 'device_id', 'device', '设备id'];
const MODEL_ALIASES = ['models', 'model', '模型配置', '模型', 'modelconfigs'];

/** 归一化表头 key */
function normKey(key: string): string {
  return key.toLowerCase().replace(/[\s_\-—:：()（）]/g, '');
}

/** 在表头映射中查找别名字段 */
function findField(headerMap: Map<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const found = headerMap.get(normKey(alias));
    if (found) return found;
  }
  return undefined;
}

/** 把一行原始对象归一化为 ParsedTarget（ip/user 缺失返回 null + reason） */
export function normalizeRow(
  row: Record<string, unknown>,
  headerMap: Map<string, string>,
): { target?: ParsedTarget; reason?: string } {
  const ipField = findField(headerMap, IP_ALIASES);
  const userField = findField(headerMap, USER_ALIASES);
  const pwdField = findField(headerMap, PASSWORD_ALIASES);
  const platformField = findField(headerMap, PLATFORM_ALIASES);
  const portField = findField(headerMap, PORT_ALIASES);
  const deviceField = findField(headerMap, DEVICE_ALIASES);
  const modelField = findField(headerMap, MODEL_ALIASES);

  const ip = ipField ? String(row[ipField] ?? '').trim() : '';
  const user = userField ? String(row[userField] ?? '').trim() : '';
  const password = pwdField ? String(row[pwdField] ?? '').trim() : '';

  if (!ip) return { reason: 'missing ip' };
  if (!user) return { reason: 'missing user' };

  const platforms: AgentType[] = [];
  if (platformField) {
    const raw = String(row[platformField] ?? '')
      .split(/[,，;；\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    for (const p of raw) {
      if ((AGENT_TYPES as readonly string[]).includes(p)) platforms.push(p as AgentType);
    }
  }

  const port = portField ? parseInt(String(row[portField] ?? '').trim(), 10) : NaN;
  const deviceId = deviceField ? String(row[deviceField] ?? '').trim() : '';
  // 模型配置：JSON 部署直接传对象数组；Excel 传字符串（JSON 或 semicolon 格式）
  let modelConfigs: PlatformModelConfig[] = [];
  if (modelField) {
    const rawModel = row[modelField];
    if (Array.isArray(rawModel)) {
      modelConfigs = (rawModel as Array<Record<string, unknown>>)
        .filter((c) => c && typeof c.agentType === 'string' && typeof c.model === 'string')
        .map((c) => ({
          agentType: c.agentType as AgentType,
          model: c.model as string,
          fallbacks: Array.isArray(c.fallbacks)
            ? (c.fallbacks as unknown[]).filter((f): f is string => typeof f === 'string')
            : [],
        }));
    } else {
      modelConfigs = parseModelConfigs(String(rawModel ?? ''));
    }
  }

  return {
    target: {
      ip,
      user,
      password: password || undefined,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined,
      deviceId: deviceId || undefined,
      platforms,
      modelConfigs: modelConfigs.length ? modelConfigs : undefined,
    },
  };
}

/**
 * 解析模型配置字段：
 * - JSON 数组：[{agentType, model, fallbacks}]
 * - 或 `agentType=model` / `agentType=model,fb1,fb2` 分号分隔
 */
export function parseModelConfigs(raw: string): PlatformModelConfig[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
      return json
        .filter(
          (c): c is PlatformModelConfig =>
            c && typeof c === 'object' && typeof c.agentType === 'string' && typeof c.model === 'string',
        )
        .map((c) => ({
          agentType: c.agentType as AgentType,
          model: c.model,
          fallbacks: Array.isArray(c.fallbacks) ? c.fallbacks.filter((f): f is string => typeof f === 'string') : [],
        }));
    }
  } catch {
    // 非 JSON，走 semicolon/等号 格式
  }

  const configs: PlatformModelConfig[] = [];
  for (const part of text.split(/[;；]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const agentType = trimmed.slice(0, eq).trim().toLowerCase();
    if (!(AGENT_TYPES as readonly string[]).includes(agentType)) continue;
    const models = trimmed
      .slice(eq + 1)
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length === 0) continue;
    configs.push({
      agentType: agentType as AgentType,
      model: models[0],
      fallbacks: models.slice(1),
    });
  }
  return configs;
}

/** 解析 Excel / CSV 二进制缓冲 */
export function parseExcel(buffer: Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { targets: [], invalidRows: [{ row: 0, reason: 'empty workbook' }] };
  }
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  // 构建 归一化 key → 原始表头 映射
  const headerMap = new Map<string, string>();
  if (rows.length > 0) {
    for (const key of Object.keys(rows[0])) {
      headerMap.set(normKey(key), key);
    }
  }

  const targets: ParsedTarget[] = [];
  const invalidRows: Array<{ row: number; reason: string }> = [];

  rows.forEach((row, idx) => {
    const { target, reason } = normalizeRow(row, headerMap);
    if (target) targets.push(target);
    else invalidRows.push({ row: idx + 2, reason: reason ?? 'invalid' }); // +2：表头行 + 1-based
  });

  return { targets, invalidRows };
}

/** 从 JSON 对象数组解析（REST 直接传 JSON 时的替代入口） */
export function parseTargetsFromObjects(rows: Array<Record<string, unknown>>): ParseResult {
  const headerMap = new Map<string, string>();
  const allKeys = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) allKeys.add(k);
  for (const key of allKeys) headerMap.set(normKey(key), key);

  const targets: ParsedTarget[] = [];
  const invalidRows: Array<{ row: number; reason: string }> = [];
  rows.forEach((row, idx) => {
    const { target, reason } = normalizeRow(row, headerMap);
    if (target) targets.push(target);
    else invalidRows.push({ row: idx + 1, reason: reason ?? 'invalid' });
  });
  return { targets, invalidRows };
}
