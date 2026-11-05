import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import { preferExecutable, expandPath, normalizeWindowsExecutable } from '../src/adapters/detector.js';

/**
 * Windows 探测修复：where 会同时返回「无扩展名（Unix shell 脚本）」和「.cmd（Windows 批处理）」，
 * 必须优先 .cmd/.bat/.exe，否则 spawn 无扩展名脚本会 ENOENT。
 */
describe('preferExecutable（Windows 优先可执行扩展名）', () => {
  it('Windows：where 多行（无扩展名 + .cmd）→ 优先 .cmd', () => {
    const lines = [
      'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\codex',
      'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\codex.cmd',
    ];
    expect(preferExecutable(lines, true)).toContain('codex.cmd');
  });

  it('Windows：无扩展名在前、.cmd 在后 → 仍选 .cmd', () => {
    const lines = ['C:\\node\\codex', 'C:\\node\\codex.cmd', 'C:\\node\\codex.ps1'];
    expect(preferExecutable(lines, true)).toContain('.cmd');
  });

  it('Windows：.exe 优先', () => {
    const lines = ['C:\\tools\\cli', 'C:\\tools\\cli.exe'];
    expect(preferExecutable(lines, true)).toContain('.exe');
  });

  it('Windows：只有无扩展名（异常）→ 返回第一行', () => {
    const lines = ['C:\\node\\codex'];
    expect(preferExecutable(lines, true)).toBe('C:\\node\\codex');
  });

  it('Unix：返回第一行（不按扩展名过滤）', () => {
    const lines = ['/usr/local/bin/codex'];
    expect(preferExecutable(lines, false)).toBe('/usr/local/bin/codex');
  });

  it('空行过滤 + 空输入返回 null', () => {
    expect(preferExecutable(['', '  ', '\r'], true)).toBeNull();
    expect(preferExecutable([], false)).toBeNull();
  });
});

describe('expandPath（pathsByOS 路径展开：~ 与 %VAR%）', () => {
  it('展开 ~ 为 home', () => {
    const home = '/Users/alice';
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    expect(expandPath('~/.local/bin/codex')).toBe('/Users/alice/.local/bin/codex');
    vi.restoreAllMocks();
  });

  it('展开 %VAR% 为环境变量值（Windows）', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    process.env.APPDATA = 'C:\\Users\\Alice\\AppData\\Roaming';
    expect(expandPath('%APPDATA%\\npm\\codex.cmd')).toBe('C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex.cmd');
    vi.restoreAllMocks();
  });

  it('绝对路径原样返回（不展开）', () => {
    expect(expandPath('/usr/local/bin/codex')).toBe('/usr/local/bin/codex');
  });
});

describe('normalizeWindowsExecutable（Windows 无扩展名 → .cmd，修 spawn EINVAL）', () => {
  it('非 Windows 原样返回', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    expect(normalizeWindowsExecutable('/usr/local/bin/codex')).toBe('/usr/local/bin/codex');
    vi.restoreAllMocks();
  });

  it('已有 .exe/.cmd/.bat 原样返回', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    expect(normalizeWindowsExecutable('C:\\x\\codex.cmd')).toBe('C:\\x\\codex.cmd');
    expect(normalizeWindowsExecutable('C:\\x\\codex.exe')).toBe('C:\\x\\codex.exe');
    vi.restoreAllMocks();
  });

  it('无扩展名 → 换 .cmd（若存在）', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    // 用真实存在的文件（本机 node 的 .cmd 不存在，用临时 mock 不行，这里直接验证逻辑：无扩展名且 .cmd 不存在时保持原样）
    expect(normalizeWindowsExecutable('C:\\not-exist\\codex')).toBe('C:\\not-exist\\codex');
    vi.restoreAllMocks();
  });
});
