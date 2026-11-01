import { describe, expect, it } from 'vitest';
import { AGENT_TYPES } from '@agentmesh/shared';
import {
  buildInstalledProbeScript,
  parseInstalledProbe,
} from '../src/services/deploy/installedProbe.js';
import { listPlatformCatalog } from '../src/services/deploy/installScripts.js';

describe('installedProbe 已装平台探测脚本生成', () => {
  it('POSIX 探测脚本包含 PATH 增强、command -v 与逐平台标记', () => {
    const script = buildInstalledProbeScript('macos');
    expect(script).toContain('export PATH');
    expect(script).toContain('$HOME/.local/bin');
    expect(script).toContain('command -v');
    for (const platform of AGENT_TYPES) {
      expect(script).toContain(`platform=${platform} status=installed`);
      expect(script).toContain(`platform=${platform} status=missing`);
    }
  });

  it('linux 与 macos 复用同一套 POSIX 探测脚本', () => {
    expect(buildInstalledProbeScript('linux')).toBe(buildInstalledProbeScript('macos'));
  });

  it('Windows 探测脚本使用 Encoded PowerShell + Get-Command', () => {
    const script = buildInstalledProbeScript('windows');
    expect(script).toMatch(/^powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand /);
    const encoded = script.split(' ').pop() as string;
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toContain('Get-Command');
    expect(decoded).toContain('platform=codex');
    // Windows 走 PowerShell，不使用 bash 的 command -v
    expect(decoded).not.toContain('command -v');
  });
});

describe('installedProbe 输出解析', () => {
  it('解析 installed/missing 标记并去重（同平台保留首次出现）', () => {
    const out = [
      '[agentmesh:installed] platform=codex status=installed',
      '[agentmesh:installed] platform=grok status=missing',
      '[agentmesh:installed] platform=codex status=missing',
      'some unrelated noise line',
    ].join('\n');
    const results = parseInstalledProbe(out);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.platform === 'codex')).toEqual({ platform: 'codex', installed: true });
    expect(results.find((r) => r.platform === 'grok')).toEqual({ platform: 'grok', installed: false });
  });

  it('无标记输出返回空数组', () => {
    expect(parseInstalledProbe('no markers here\nanother line')).toEqual([]);
  });
});

describe('listPlatformCatalog 平台目录', () => {
  it('返回 13 个平台，顺序与 AGENT_TYPES 一致', () => {
    const catalog = listPlatformCatalog();
    expect(catalog).toHaveLength(13);
    expect(catalog.map((c) => c.platform)).toEqual([...AGENT_TYPES]);
    expect(catalog[0].platform).toBe('codex');
    expect(catalog[catalog.length - 1].platform).toBe('windsurf');
  });

  it('每个条目都有非空 displayName 与非空 commandNames 数组', () => {
    for (const item of listPlatformCatalog()) {
      expect(typeof item.displayName).toBe('string');
      expect(item.displayName.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(item.commandNames)).toBe(true);
      expect(item.commandNames.length).toBeGreaterThan(0);
    }
  });

  it('关键平台 npmPackage 正确', () => {
    const catalog = listPlatformCatalog();
    expect(catalog.find((c) => c.platform === 'codex')?.npmPackage).toBe('@openai/codex');
    expect(catalog.find((c) => c.platform === 'claude')?.npmPackage).toBe('@anthropic-ai/claude-code');
  });
});
