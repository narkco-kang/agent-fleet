import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  normalizeRow,
  parseExcel,
  parseModelConfigs,
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

  it('解析自定义 SSH 端口（默认 22，非法回退 undefined）', () => {
    const buf = buildXlsx([
      { IP: '10.0.0.6', user: 'root', port: '2222' },
      { IP: '10.0.0.7', user: 'root', port: 'not-a-port' },
    ]);
    const { targets } = parseExcel(buf);
    expect(targets[0].port).toBe(2222);
    expect(targets[1].port).toBeUndefined();
  });

  it('normalizeRow 兼容中文「端口」「设备id」别名', () => {
    const headerMap = new Map([
      ['ip', 'ip'],
      ['username', 'username'],
      ['端口', '端口'],
      ['设备id', '设备id'],
    ]);
    const { target } = normalizeRow(
      { ip: '10.0.0.1', username: 'u', 端口: '2222', 设备id: 'dev-9' },
      headerMap,
    );
    expect(target?.port).toBe(2222);
    expect(target?.deviceId).toBe('dev-9');
  });

  it('解析 deviceId 与模型配置（部署完成即绑定模型）', () => {
    const buf = buildXlsx([
      {
        IP: '10.0.0.8',
        user: 'root',
        deviceId: 'dev-1',
        platforms: 'codex',
        models: 'codex=kimi/k3,glm/strong;claude=claude/opus',
      },
    ]);
    const { targets } = parseExcel(buf);
    expect(targets[0].deviceId).toBe('dev-1');
    expect(targets[0].modelConfigs).toEqual([
      { agentType: 'codex', model: 'kimi/k3', fallbacks: ['glm/strong'] },
      { agentType: 'claude', model: 'claude/opus', fallbacks: [] },
    ]);
  });

  it('parseModelConfigs 兼容 JSON 数组与等号列表', () => {
    expect(
      parseModelConfigs(JSON.stringify([{ agentType: 'qwen', model: 'qwen/max', fallbacks: ['qwen/plus'] }])),
    ).toEqual([{ agentType: 'qwen', model: 'qwen/max', fallbacks: ['qwen/plus'] }]);
    expect(parseModelConfigs('')).toEqual([]);
    expect(parseModelConfigs('badagent=x')).toEqual([]);
  });
});
