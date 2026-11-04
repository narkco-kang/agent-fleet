import { describe, expect, it } from 'vitest';
import { buildSandboxCommand, isSandboxSupported } from '../src/runner/sandbox.js';

describe('三态沙箱 runner（P0-2）', () => {
  it('none 原样返回命令', () => {
    const r = buildSandboxCommand('none', 'codex', ['exec', 'hi']);
    expect(r.cmd).toBe('codex');
    expect(r.args).toEqual(['exec', 'hi']);
  });

  it('readonly 包裹命令（sandbox-exec 或 bwrap）', () => {
    const r = buildSandboxCommand('readonly', 'codex', ['exec', 'hi']);
    expect(r.cmd).not.toBe('codex'); // 被包裹
    // 包裹命令后，原命令和参数仍在 args 里
    const joined = [r.cmd, ...r.args].join(' ');
    expect(joined).toContain('codex');
    expect(joined).toContain('exec');
    expect(joined).toContain('hi');
  });

  it('isolated 比 readonly 更强（额外网络隔离）', () => {
    const ro = buildSandboxCommand('readonly', 'codex', ['x']).args.join(' ');
    const iso = buildSandboxCommand('isolated', 'codex', ['x']).args.join(' ');
    // isolated 额外含网络隔离标记（macOS deny network* 或 linux --unshare-net）
    const hasNetIsolation = iso.includes('network') || iso.includes('unshare-net');
    expect(hasNetIsolation).toBe(true);
    expect(ro).not.toBe(iso);
  });

  it('isSandboxSupported：none 恒 true，其余看平台', () => {
    expect(isSandboxSupported('none')).toBe(true);
    const supported = process.platform === 'darwin' || process.platform === 'linux';
    expect(isSandboxSupported('readonly')).toBe(supported);
  });
});
