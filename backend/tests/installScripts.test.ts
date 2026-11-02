import { describe, expect, it } from 'vitest';
import {
  adaptPlatformsForOS,
  buildInstallPlan,
  buildInstallPlanStep,
  buildInstallScript,
  defaultPlatformsForOS,
  parseInstallVerification,
} from '../src/services/deploy/installScripts.js';

describe('deploy installScripts OS 自适应部署计划', () => {
  it('Excel 未指定平台时按 OS 选择公开包管理器可部署的默认 CLI 集', () => {
    expect(defaultPlatformsForOS('macos')).toEqual(['codex', 'claude', 'gemini', 'qwen', 'aider', 'opencode']);
    expect(defaultPlatformsForOS('linux')).toContain('aider');
    expect(defaultPlatformsForOS('windows')).toContain('opencode');
    expect(adaptPlatformsForOS('macos', [])).toEqual(defaultPlatformsForOS('macos'));
  });

  it('生成真实包管理器命令，不再出现 example.com 伪安装源', () => {
    const script = buildInstallScript('macos', ['codex', 'claude', 'aider', 'grok']);
    expect(script).toContain('npm install -g');
    expect(script).toContain('pipx install');
    expect(script).toContain('manual_required grok');
    expect(script).not.toContain('example');
  });

  it('Windows 自动使用 Encoded PowerShell，CLI 包走 npm/pipx', () => {
    const script = buildInstallScript('windows', ['codex', 'aider']);
    expect(script).toMatch(/^powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand /);
    const codex = buildInstallPlanStep('windows', 'codex');
    const aider = buildInstallPlanStep('windows', 'aider');
    expect(codex.method).toBe('npm');
    expect(codex.command).toContain('npm install -g @openai/codex');
    expect(aider.method).toBe('pipx');
    expect(aider.command).toContain('pipx install aider-chat');
  });

  it('GUI 平台按 OS 适配：macOS 用 brew cask，Windows 用 winget，Linux 只验证/提示', () => {
    expect(buildInstallPlanStep('macos', 'cursor').method).toBe('brew-cask');
    expect(buildInstallPlanStep('windows', 'cursor').method).toBe('winget');
    const linuxCursor = buildInstallPlanStep('linux', 'cursor');
    expect(linuxCursor.method).toBe('unsupported');
    expect(linuxCursor.command).toContain('manual_required cursor');
  });

  it('解析部署脚本输出中的逐平台验证结果', () => {
    const out = [
      '[agentfleet:verify] platform=codex status=ok command=codex',
      '[agentfleet:verify] platform=grok status=missing',
      '[agentfleet:verify] platform=codex status=missing',
    ].join('\n');
    const results = parseInstallVerification(out);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.platform === 'codex')).toMatchObject({ ok: false });
    expect(results.find((r) => r.platform === 'grok')).toMatchObject({ ok: false });
  });

  it('构建部署计划时保留用户请求顺序并去重', () => {
    expect(buildInstallPlan('linux', ['qwen', 'qwen', 'codex']).map((s) => s.platform)).toEqual(['qwen', 'codex']);
  });
});
