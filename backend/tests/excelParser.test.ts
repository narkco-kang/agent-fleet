import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  normalizeRow,
  parseExcel,
  parseTargetsFromObjects,
} from '../src/services/deploy/excelParser.js';

function buildXlsx(rows: Array<Record<string, string>>): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('excelParser', () => {
  it('解析有效行 → targets（ip/user/password）', () => {
    const buf = buildXlsx([
      { IP: '192.168.1.10', 账号: 'root', 密码: 'secret1' },
      { IP: '192.168.1.11', 账号: 'admin', 密码: 'secret2' },
    ]);
    const { targets, invalidRows } = parseExcel(buf);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ ip: '192.168.1.10', user: 'root', password: 'secret1' });
    expect(invalidRows).toHaveLength(0);
  });

  it('坏行（缺 IP / 账号）→ invalidRows[]', () => {
    const buf = buildXlsx([
      { IP: '', 账号: 'root', 密码: 'x' },
      { IP: '10.0.0.1', 账号: '', 密码: 'x' },
      { IP: '10.0.0.2', 账号: 'root', 密码: 'x' },
    ]);
    const { targets, invalidRows } = parseExcel(buf);
    expect(targets).toHaveLength(1);
    expect(invalidRows).toHaveLength(2);
    expect(invalidRows.map((r) => r.reason)).toContain('missing ip');
    expect(invalidRows.map((r) => r.reason)).toContain('missing user');
  });

  it('平台列解析为 AgentType 数组', () => {
    const buf = buildXlsx([
      { IP: '10.0.0.5', user: 'root', password: 'x', platforms: 'codex, claude' },
    ]);
    const { targets } = parseExcel(buf);
    expect(targets[0].platforms).toEqual(['codex', 'claude']);
  });

  it('normalizeRow 兼容英文字段名', () => {
    const headerMap = new Map([
      ['ip', 'ip'],
      ['username', 'username'],
      ['password', 'password'],
    ]);
    const { target } = normalizeRow(
      { ip: '10.0.0.9', username: 'u', password: 'p' },
      headerMap,
    );
    expect(target).toMatchObject({ ip: '10.0.0.9', user: 'u', password: 'p' });
  });

  it('parseTargetsFromObjects 直接解析 JSON 数组', () => {
    const { targets, invalidRows } = parseTargetsFromObjects([
      { ip: '10.0.0.3', user: 'root', password: 'pw' },
      { ip: '10.0.0.4' },
    ]);
    expect(targets).toHaveLength(1);
    expect(invalidRows).toHaveLength(1);
  });
});
