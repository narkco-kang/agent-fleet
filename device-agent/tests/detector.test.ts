import { describe, it, expect } from 'vitest';
import { preferExecutable } from '../src/adapters/detector.js';

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
