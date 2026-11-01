import * as XLSX from 'xlsx';
import type { AgentType } from '@agentmesh/shared';
import { AGENT_TYPES } from '@agentmesh/shared';

/**
 * Excel 解析（F1）：读取 .xlsx/.csv → 提取 IP / 账号 / 密码 / 平台。
 * 密码只进入内存 DeploymentCredential（由 deployService 持有），绝不落库。
 */

/** 解析后的单行目标（含内存密码） */
export interface ParsedTarget {
  ip: string;
  user: string;
  password?: string;
  platforms: AgentType[];
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

  return { target: { ip, user, password: password || undefined, platforms } };
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
