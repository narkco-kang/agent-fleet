import { describe, expect, it } from 'vitest';
import { launchCommandFor, loginMethodFor } from '@agentfleet/shared';

describe('platformLaunch 打开平台应用命令（OS 自适应）', () => {
  it('macOS GUI 应用用 open -a', () => {
    const c = launchCommandFor('cursor', 'darwin');
    expect(c.method).toBe('app');
    expect(c.command).toContain('open -a');
    expect(c.command).toContain('Cursor');
  });

  it('macOS CLI 用 osascript 终端启动', () => {
    const c = launchCommandFor('codex', 'darwin');
    expect(c.method).toBe('cli');
    expect(c.command).toContain('osascript');
    expect(c.command).toContain('codex');
  });

  it('Windows GUI 应用用 start', () => {
    const c = launchCommandFor('windsurf', 'win32');
    expect(c.method).toBe('app');
    expect(c.command).toContain('start');
  });

  it('Windows CLI 用 cmd /k', () => {
    const c = launchCommandFor('claude', 'win32');
    expect(c.method).toBe('cli');
    expect(c.command).toContain('cmd /k');
  });

  it('Linux CLI 用 x-terminal-emulator', () => {
    const c = launchCommandFor('gemini', 'linux');
    expect(c.method).toBe('cli');
    expect(c.command).toContain('x-terminal-emulator');
  });

  it('Linux 仅 GUI 应用（无 CLI）不自动打开（unsupported）', () => {
    const c = launchCommandFor('dsh', 'linux');
    expect(c.method).toBe('unsupported');
  });

  it('未知平台返回 unsupported', () => {
    const c = launchCommandFor('nope' as never, 'darwin');
    expect(c.method).toBe('unsupported');
  });
});

describe('loginMethodFor 登录授权方式分类（看板授权中心）', () => {
  it('device-auth：codex/claude/cursor/kimi/opencode', () => {
    for (const t of ['codex', 'claude', 'cursor', 'kimi', 'opencode']) {
      expect(loginMethodFor(t)).toBe('device-auth');
    }
  });

  it('api-key：gemini/qwen/aider/grok（grok 无 device-auth，用 XAI_API_KEY）', () => {
    for (const t of ['gemini', 'qwen', 'aider', 'grok']) {
      expect(loginMethodFor(t)).toBe('api-key');
    }
  });

  it('app：dsh/workbuddy/windsurf（桌面应用登录）', () => {
    for (const t of ['dsh', 'workbuddy', 'windsurf']) {
      expect(loginMethodFor(t)).toBe('app');
    }
  });

  it('cli：cody/doubao（打开终端登录）', () => {
    for (const t of ['cody', 'doubao']) {
      expect(loginMethodFor(t)).toBe('cli');
    }
  });
});
