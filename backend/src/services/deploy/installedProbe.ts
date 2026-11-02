import type { AgentType, DeployOS } from '@agentfleet/shared';
import { AGENT_TYPES } from '@agentfleet/shared';
import type { SshConnection } from './sshClient.js';
import { getInstallSpec } from './installScripts.js';

/**
 * 已装平台探测（F1 增强）：对一台 SSH 目标机，探测 13 个 agent 平台哪些已安装。
 *
 * 与 installScripts.ts 的验证逻辑保持一致：
 * - POSIX 使用 `command -v`，并把 npm/pipx/brew 的全局 bin 目录加入 PATH，
 *   确保 `command -v` 能命中通过包管理器安装的 CLI。
 * - Windows 使用 PowerShell `Get-Command`，脚本经 UTF-16LE base64 编码后执行。
 * - 输出统一为 `[agentfleet:installed] platform=<p> status=installed|missing` 标记。
 */

export interface InstalledProbeResult {
  platform: AgentType;
  installed: boolean;
}

/** 生成探测脚本：逐平台检查 commandNames，任一命令命中即输出 installed */
export function buildInstalledProbeScript(os: DeployOS): string {
  if (os === 'windows') return buildWindowsProbeScript();
  return buildPosixProbeScript();
}

/** 解析探测输出：匹配标记并去重（同平台保留第一次出现） */
export function parseInstalledProbe(output: string): InstalledProbeResult[] {
  const results: InstalledProbeResult[] = [];
  const seen = new Set<string>();
  const re = /\[agentfleet:installed\]\s+platform=([^\s]+)\s+status=(installed|missing)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const platform = m[1] as AgentType;
    if (seen.has(platform)) continue;
    seen.add(platform);
    results.push({ platform, installed: m[2] === 'installed' });
  }
  return results;
}

/** 在已建立 SSH 连接上执行探测，返回结果 + installed/missing 列表 */
export async function probeInstalledPlatforms(
  conn: SshConnection,
  os: DeployOS,
): Promise<{ results: InstalledProbeResult[]; installed: AgentType[]; missing: AgentType[] }> {
  const execRes = await conn.exec(buildInstalledProbeScript(os));
  const output = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n');
  const results = parseInstalledProbe(output);
  const installed = results.filter((r) => r.installed).map((r) => r.platform);
  const missing = results.filter((r) => !r.installed).map((r) => r.platform);
  return { results, installed, missing };
}

function buildPosixProbeScript(): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set +e',
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'echo "[agentfleet] installed_probe begin"',
  ];
  for (const platform of AGENT_TYPES) {
    const spec = getInstallSpec(platform);
    const names = spec?.commandNames?.length ? spec.commandNames : [platform];
    const quotedNames = names.map(shellQuote).join(' ');
    lines.push('agentfleet_found=0');
    lines.push(`for agentfleet_n in ${quotedNames}; do`);
    lines.push('  if command -v "$agentfleet_n" >/dev/null 2>&1; then agentfleet_found=1; break; fi');
    lines.push('done');
    lines.push(
      `if [ "$agentfleet_found" = "1" ]; then echo "[agentfleet:installed] platform=${platform} status=installed"; else echo "[agentfleet:installed] platform=${platform} status=missing"; fi`,
    );
  }
  lines.push('echo "[agentfleet] installed_probe end"');
  return lines.join('\n');
}

function buildWindowsProbeScript(): string {
  const psLines = [
    '$ErrorActionPreference = "Continue"',
    'Write-Output "[agentfleet] installed_probe begin"',
  ];
  for (const platform of AGENT_TYPES) {
    const spec = getInstallSpec(platform);
    const names = spec?.commandNames?.length ? spec.commandNames : [platform];
    const checks = names
      .map((name) => `(Get-Command ${psQuote(name)} -ErrorAction SilentlyContinue)`)
      .join(' -or ');
    psLines.push(
      `if (${checks}) { Write-Output ${psQuote(`[agentfleet:installed] platform=${platform} status=installed`)} } else { Write-Output ${psQuote(`[agentfleet:installed] platform=${platform} status=missing`)} }`,
    );
  }
  psLines.push('Write-Output "[agentfleet] installed_probe end"');
  const encoded = Buffer.from(psLines.join('; '), 'utf16le').toString('base64');
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

/** POSIX 单引号转义（与 installScripts.ts 的 shellQuote 语义一致） */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/** PowerShell 单引号转义（与 installScripts.ts 的 psQuote 语义一致） */
function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
