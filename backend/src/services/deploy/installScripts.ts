import type { AgentType, DeployOS } from '@agentfleet/shared';
import { AGENT_TYPES } from '@agentfleet/shared';

/**
 * 安装脚本生成（F1 增强）：按目标 OS 自动适配 agent 平台安装方式。
 *
 * 目标：
 * - 不再使用 example.com 伪安装源；所有命令要么是公开包管理器命令，要么明确标记 manual_required。
 * - 同一份 Excel/JSON 目标可以投给 macOS/Linux/Windows，SSH 探测 OS 后自动选择 npm/pipx/brew/winget/PowerShell。
 * - 安装后必须逐个平台验证命令是否真实可执行，deployService 以验证结果决定成功/失败。
 */

export type InstallMethod = 'npm' | 'pipx' | 'brew-cask' | 'winget' | 'manual' | 'unsupported';

export interface PlatformInstallSpec {
  platform: AgentType;
  commandNames: string[];
  npmPackage?: string;
  pipxPackage?: string;
  brewCask?: string;
  wingetId?: string;
  /** 该平台目前只能检测/验证，不能可靠自动安装 */
  manualReason?: string;
}

export interface InstallPlanStep {
  platform: AgentType;
  os: DeployOS;
  method: InstallMethod;
  command: string;
  verifyCommand: string;
  supported: boolean;
  commandNames: string[];
  notes: string[];
}

export interface InstallVerification {
  platform: AgentType;
  ok: boolean;
  command?: string;
  method?: InstallMethod;
  raw: string;
}

/** 平台安装目录：尽量复用官方/主流包管理器；不确定的商业/私有平台只做 manual_required */
const INSTALL_SPECS: Record<AgentType, PlatformInstallSpec> = {
  codex: {
    platform: 'codex',
    commandNames: ['codex'],
    npmPackage: '@openai/codex',
  },
  claude: {
    platform: 'claude',
    commandNames: ['claude'],
    npmPackage: '@anthropic-ai/claude-code',
  },
  dsh: {
    platform: 'dsh',
    commandNames: ['dsh', 'dsh-desktop'],
    manualReason: 'DSH Desktop installer is not publicly standardized; verify an existing installation only.',
  },
  grok: {
    platform: 'grok',
    commandNames: ['grok'],
    manualReason: 'Grok CLI installation requires the user-provided distribution/login channel; verify an existing ~/.grok/bin/grok only.',
  },
  cursor: {
    platform: 'cursor',
    commandNames: ['cursor', 'cursor-agent'],
    brewCask: 'cursor',
    wingetId: 'Anysphere.Cursor',
  },
  aider: {
    platform: 'aider',
    commandNames: ['aider'],
    pipxPackage: 'aider-chat',
  },
  gemini: {
    platform: 'gemini',
    commandNames: ['gemini'],
    npmPackage: '@google/gemini-cli',
  },
  cody: {
    platform: 'cody',
    commandNames: ['cody'],
    npmPackage: '@sourcegraph/cody',
  },
  qwen: {
    platform: 'qwen',
    commandNames: ['qwen', 'qwen-code'],
    npmPackage: '@qwen-code/qwen-code',
  },
  doubao: {
    platform: 'doubao',
    commandNames: ['doubao', 'marscode', 'mars-code'],
    npmPackage: '@bytedance/mars-code',
  },
  kimi: {
    platform: 'kimi',
    commandNames: ['kimi', 'kimi-cli'],
    npmPackage: 'kimi-cli',
  },
  opencode: {
    platform: 'opencode',
    commandNames: ['opencode'],
    npmPackage: 'opencode-ai',
  },
  windsurf: {
    platform: 'windsurf',
    commandNames: ['windsurf'],
    brewCask: 'windsurf',
    wingetId: 'Codeium.Windsurf',
  },
};

/** Excel 未指定平台时，根据 OS 自动选择可通过公开包管理器部署的 CLI 优先集 */
const DEFAULT_PLATFORMS_BY_OS: Record<DeployOS, AgentType[]> = {
  macos: ['codex', 'claude', 'gemini', 'qwen', 'aider', 'opencode'],
  linux: ['codex', 'claude', 'gemini', 'qwen', 'aider', 'opencode'],
  windows: ['codex', 'claude', 'gemini', 'qwen', 'aider', 'opencode'],
  unknown: ['codex', 'claude', 'gemini', 'qwen'],
};

/** 对外暴露平台安装规格，便于诊断/测试 */
export function getInstallSpec(platform: AgentType): PlatformInstallSpec {
  return INSTALL_SPECS[platform];
}

/** 按 OS 返回未指定平台时的一键部署默认集 */
export function defaultPlatformsForOS(os: DeployOS): AgentType[] {
  return [...DEFAULT_PLATFORMS_BY_OS[os]];
}

/** 根据探测到的 OS 和用户请求自动适配最终部署平台列表 */
export function adaptPlatformsForOS(os: DeployOS, requested: AgentType[]): AgentType[] {
  const base = requested.length > 0 ? requested : defaultPlatformsForOS(os);
  return Array.from(new Set(base));
}

/** 生成单个平台的 OS 自适应安装计划 */
export function buildInstallPlanStep(os: DeployOS, platform: AgentType): InstallPlanStep {
  const spec = INSTALL_SPECS[platform];
  const verifyCommand = verifyCommandFor(os, platform);
  const notes: string[] = [];

  if (!spec) {
    return {
      platform,
      os,
      method: 'unsupported',
      command: markerCommand(os, `manual_required ${platform}: unsupported platform`),
      verifyCommand,
      supported: false,
      commandNames: [platform],
      notes: ['unsupported platform'],
    };
  }

  if (spec.manualReason) {
    notes.push(spec.manualReason);
    return {
      platform,
      os,
      method: 'manual',
      command: markerCommand(os, `manual_required ${platform}: ${spec.manualReason}`),
      verifyCommand,
      supported: true,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (spec.npmPackage) {
    return {
      platform,
      os,
      method: 'npm',
      command: npmInstallCommand(os, spec.npmPackage),
      verifyCommand,
      supported: true,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (spec.pipxPackage) {
    return {
      platform,
      os,
      method: 'pipx',
      command: pipxInstallCommand(os, spec.pipxPackage),
      verifyCommand,
      supported: true,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (os === 'macos' && spec.brewCask) {
    return {
      platform,
      os,
      method: 'brew-cask',
      command: `brew list --cask ${shellQuote(spec.brewCask)} >/dev/null 2>&1 || brew install --cask ${shellQuote(spec.brewCask)}`,
      verifyCommand,
      supported: true,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (os === 'windows' && spec.wingetId) {
    return {
      platform,
      os,
      method: 'winget',
      command: `winget list --id ${spec.wingetId} --exact >$null 2>$null; if ($LASTEXITCODE -ne 0) { winget install --id ${spec.wingetId} --exact --accept-source-agreements --accept-package-agreements }`,
      verifyCommand,
      supported: true,
      commandNames: spec.commandNames,
      notes,
    };
  }

  return {
    platform,
    os,
    method: 'unsupported',
    command: markerCommand(os, `manual_required ${platform}: no installer for ${os}`),
    verifyCommand,
    supported: false,
    commandNames: spec.commandNames,
    notes: [`no installer for ${os}`],
  };
}

/** 生成完整部署计划 */
export function buildInstallPlan(os: DeployOS, platforms: AgentType[]): InstallPlanStep[] {
  return adaptPlatformsForOS(os, platforms).map((platform) => buildInstallPlanStep(os, platform));
}

/** 生成验证命令（安装后探测是否可执行） */
export function verifyCommandFor(os: DeployOS, platform: AgentType): string {
  const spec = INSTALL_SPECS[platform];
  const names = spec?.commandNames?.length ? spec.commandNames : [platform];
  if (os === 'windows') {
    const checks = names
      .map((name) => `if (-not $agentfleetVerifyOk -and (Get-Command ${psQuote(name)} -ErrorAction SilentlyContinue)) { Write-Output ${psQuote(`[agentfleet:verify] platform=${platform} status=ok command=${name}`)}; $agentfleetVerifyOk = $true }`)
      .join('; ');
    return `$agentfleetVerifyOk = $false; ${checks}; if (-not $agentfleetVerifyOk) { Write-Output ${psQuote(`[agentfleet:verify] platform=${platform} status=missing`)} }`;
  }
  const checks = names
    .map((name) => `if command -v ${shellQuote(name)} >/dev/null 2>&1; then echo "[agentfleet:verify] platform=${platform} status=ok command=${name}"; exit 0; fi`)
    .join(' ');
  return `${checks} echo "[agentfleet:verify] platform=${platform} status=missing"; exit 1`;
}

/** 生成完整安装脚本。deployService 会解析 [agentfleet:verify] 标记决定成功/失败。 */
export function buildInstallScript(os: DeployOS, platforms: AgentType[]): string {
  const plan = buildInstallPlan(os, platforms);
  if (os === 'windows') return buildWindowsScript(plan);
  return buildPosixScript(os, plan);
}

/** 从安装输出解析逐个平台验证结果 */
export function parseInstallVerification(output: string): InstallVerification[] {
  const results: InstallVerification[] = [];
  const seen = new Set<string>();
  const re = /\[agentfleet:verify\]\s+platform=([^\s]+)\s+status=(ok|missing)(?:\s+command=([^\s]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const platform = m[1] as AgentType;
    seen.add(platform);
    results.push({
      platform,
      ok: m[2] === 'ok',
      command: m[3],
      raw: m[0],
    });
  }
  // 同一平台只保留最后一次验证结果（脚本重试/补偿时避免重复）
  return Array.from(seen).map((platform) => [...results].reverse().find((r) => r.platform === platform) as InstallVerification);
}

// ============================================================
// 一键卸载（uninstall）：按 OS × 平台生成卸载脚本 + 卸载后验证
// ============================================================

export type UninstallMethod = 'npm' | 'pipx' | 'brew-cask' | 'winget' | 'manual' | 'unsupported';

export interface UninstallPlanStep {
  platform: AgentType;
  os: DeployOS;
  method: UninstallMethod;
  command: string;
  verifyCommand: string;
  commandNames: string[];
  notes: string[];
}

export interface UninstallVerification {
  platform: AgentType;
  /** true = 已确认移除（命令不存在） */
  removed: boolean;
  raw: string;
}

/** 生成单个平台的卸载计划 */
export function buildUninstallPlanStep(os: DeployOS, platform: AgentType): UninstallPlanStep {
  const spec = INSTALL_SPECS[platform];
  const verifyCommand = uninstallVerifyCommand(os, platform);

  if (!spec) {
    return {
      platform,
      os,
      method: 'unsupported',
      command: markerCommand(os, `manual_required_uninstall ${platform}: unsupported platform`),
      verifyCommand,
      commandNames: [platform],
      notes: ['unsupported platform'],
    };
  }

  const notes: string[] = [];
  if (spec.manualReason) notes.push(spec.manualReason);

  if (spec.npmPackage) {
    return {
      platform,
      os,
      method: 'npm',
      command:
        os === 'windows'
          ? `npm uninstall -g ${spec.npmPackage}`
          : `if command -v npm >/dev/null 2>&1; then npm uninstall -g ${shellQuote(spec.npmPackage)}; else echo "[agentfleet] npm not found, skip"; fi`,
      verifyCommand,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (spec.pipxPackage) {
    return {
      platform,
      os,
      method: 'pipx',
      command:
        os === 'windows'
          ? `if (Get-Command pipx -ErrorAction SilentlyContinue) { pipx uninstall ${spec.pipxPackage} }`
          : `if command -v pipx >/dev/null 2>&1; then pipx uninstall ${shellQuote(spec.pipxPackage)} || true; else echo "[agentfleet] pipx not found, skip"; fi`,
      verifyCommand,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (os === 'macos' && spec.brewCask) {
    return {
      platform,
      os,
      method: 'brew-cask',
      command: `if command -v brew >/dev/null 2>&1; then brew uninstall --cask ${shellQuote(spec.brewCask)} || true; else echo "[agentfleet] brew not found, skip"; fi`,
      verifyCommand,
      commandNames: spec.commandNames,
      notes,
    };
  }

  if (os === 'windows' && spec.wingetId) {
    return {
      platform,
      os,
      method: 'winget',
      command: `winget uninstall --id ${spec.wingetId} --exact --silent --accept-source-agreements`,
      verifyCommand,
      commandNames: spec.commandNames,
      notes,
    };
  }

  return {
    platform,
    os,
    method: 'manual',
    command: markerCommand(os, `manual_required_uninstall ${platform}: no uninstaller for ${os}`),
    verifyCommand,
    commandNames: spec.commandNames,
    notes: [`no uninstaller for ${os}`, ...notes],
  };
}

export function buildUninstallPlan(os: DeployOS, platforms: AgentType[]): UninstallPlanStep[] {
  return adaptPlatformsForOS(os, platforms).map((platform) => buildUninstallPlanStep(os, platform));
}

/** 卸载后验证：所有命令都不存在才算移除成功 */
export function uninstallVerifyCommand(os: DeployOS, platform: AgentType): string {
  const spec = INSTALL_SPECS[platform];
  const names = spec?.commandNames?.length ? spec.commandNames : [platform];
  if (os === 'windows') {
    const checks = names
      .map((name) => `if (Get-Command ${psQuote(name)} -ErrorAction SilentlyContinue) { $agentfleetStill = $true }`)
      .join('; ');
    return `$agentfleetStill = $false; ${checks}; if ($agentfleetStill) { Write-Output ${psQuote(`[agentfleet:unverify] platform=${platform} status=still_present`)} } else { Write-Output ${psQuote(`[agentfleet:unverify] platform=${platform} status=removed`)} }`;
  }
  const checks = names
    .map((name) => `if command -v ${shellQuote(name)} >/dev/null 2>&1; then agentfleet_still=1; fi`)
    .join('; ');
  return `agentfleet_still=0; ${checks}; if [ "$agentfleet_still" = "1" ]; then echo "[agentfleet:unverify] platform=${platform} status=still_present"; else echo "[agentfleet:unverify] platform=${platform} status=removed"; fi`;
}

/** 生成完整卸载脚本 */
export function buildUninstallScript(os: DeployOS, platforms: AgentType[]): string {
  const plan = buildUninstallPlan(os, platforms);
  if (os === 'windows') return buildWindowsUninstallScript(plan);
  return buildPosixUninstallScript(os, plan);
}

/** 解析卸载输出 */
export function parseUninstallVerification(output: string): UninstallVerification[] {
  const results: UninstallVerification[] = [];
  const re = /\[agentfleet:unverify\]\s+platform=([^\s]+)\s+status=(removed|still_present)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    results.push({ platform: m[1] as AgentType, removed: m[2] === 'removed', raw: m[0] });
  }
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.platform)) return false;
    seen.add(r.platform);
    return true;
  });
}

function buildPosixUninstallScript(os: DeployOS, plan: UninstallPlanStep[]): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set +e',
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    `echo "[agentfleet] uninstall begin os=${os}"`,
  ];
  for (const step of plan) {
    lines.push(`echo "[agentfleet] uninstalling ${step.platform} method=${step.method}"`);
    lines.push(step.command);
    lines.push(`echo "[agentfleet] uninstall_exit ${step.platform} code=$?"`);
    lines.push(`echo "[agentfleet] verifying_removed ${step.platform}"`);
    lines.push(step.verifyCommand);
  }
  lines.push('echo "[agentfleet] uninstall end"');
  return lines.join('\n');
}

function buildWindowsUninstallScript(plan: UninstallPlanStep[]): string {
  const psLines = [
    '$ErrorActionPreference = "Continue"',
    'Write-Output "[agentfleet] uninstall begin os=windows"',
  ];
  for (const step of plan) {
    psLines.push(`Write-Output ${psQuote(`[agentfleet] uninstalling ${step.platform} method=${step.method}`)}`);
    psLines.push(step.command);
    psLines.push(`Write-Output ${psQuote(`[agentfleet] uninstall_exit ${step.platform} code=$LASTEXITCODE`)}`);
    psLines.push(step.verifyCommand);
  }
  psLines.push('Write-Output "[agentfleet] uninstall end"');
  const encoded = Buffer.from(psLines.join('; '), 'utf16le').toString('base64');
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

/** 纯 echo 骨架（无需真实安装，仅验证流程连通） */
export function buildEchoScript(os: DeployOS, platforms: AgentType[]): string {
  const lines: string[] = [];
  for (const platform of adaptPlatformsForOS(os, platforms)) {
    lines.push(markerCommand(os, `skeleton install ${platform} on ${os}`));
  }
  return lines.join(os === 'windows' ? '\r\n' : '\n');
}

function buildPosixScript(os: DeployOS, plan: InstallPlanStep[]): string {
  const lines = [
    '#!/usr/bin/env bash',
    'set +e',
    'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    `echo "[agentfleet] deploy begin os=${os}"`,
  ];
  for (const step of plan) {
    lines.push(`echo "[agentfleet] installing ${step.platform} method=${step.method}"`);
    lines.push(step.command);
    lines.push('install_code=$?');
    lines.push(`echo "[agentfleet] install_exit ${step.platform} code=$install_code"`);
    lines.push(`echo "[agentfleet] verifying ${step.platform}"`);
    lines.push(`( ${step.verifyCommand} )`);
    lines.push(`echo "[agentfleet] verify_exit ${step.platform} code=$?"`);
  }
  lines.push('echo "[agentfleet] deploy end"');
  return lines.join('\n');
}

function buildWindowsScript(plan: InstallPlanStep[]): string {
  const psLines = [
    '$ErrorActionPreference = "Continue"',
    'Write-Output "[agentfleet] deploy begin os=windows"',
  ];
  for (const step of plan) {
    psLines.push(`Write-Output ${psQuote(`[agentfleet] installing ${step.platform} method=${step.method}`)}`);
    psLines.push(step.command);
    psLines.push(`Write-Output ${psQuote(`[agentfleet] install_exit ${step.platform} code=$LASTEXITCODE`)}`);
    psLines.push(`Write-Output ${psQuote(`[agentfleet] verifying ${step.platform}`)}`);
    psLines.push(step.verifyCommand);
    psLines.push(`Write-Output ${psQuote(`[agentfleet] verify_exit ${step.platform} code=$LASTEXITCODE`)}`);
  }
  psLines.push('Write-Output "[agentfleet] deploy end"');
  const encoded = Buffer.from(psLines.join('; '), 'utf16le').toString('base64');
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
}

function npmInstallCommand(os: DeployOS, pkg: string): string {
  if (os === 'windows') {
    return `if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required" }; npm install -g ${pkg}`;
  }
  return `if ! command -v npm >/dev/null 2>&1; then echo "[agentfleet] npm is required"; else npm install -g ${shellQuote(pkg)}; fi`;
}

function pipxInstallCommand(os: DeployOS, pkg: string): string {
  if (os === 'windows') {
    return `if (-not (Get-Command pipx -ErrorAction SilentlyContinue)) { py -m pip install --user pipx }; pipx install ${pkg}`;
  }
  return `if ! command -v pipx >/dev/null 2>&1; then python3 -m pip install --user pipx; fi; pipx install ${shellQuote(pkg)} || pipx upgrade ${shellQuote(pkg)}`;
}

function markerCommand(os: DeployOS, msg: string): string {
  return os === 'windows' ? `Write-Output ${psQuote(`[agentfleet] ${msg}`)}` : `echo ${shellQuote(`[agentfleet] ${msg}`)}`;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// ============================================================
// 平台目录（供前端「批量勾选平台」与「已装平台识别」使用）
// ============================================================

/** 13 个 agent 平台的中文展示名 */
export const PLATFORM_DISPLAY_NAMES: Record<AgentType, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  dsh: 'DSH Desktop',
  grok: 'Grok',
  cursor: 'Cursor',
  aider: 'Aider',
  gemini: 'Gemini CLI',
  cody: 'Cody',
  qwen: 'Qwen Code',
  doubao: '豆包 MarsCode',
  kimi: 'Kimi CLI',
  opencode: 'OpenCode',
  windsurf: 'Windsurf',
};

/** 平台目录条目（扁平化 install spec，供前端渲染勾选网格） */
export interface PlatformCatalogItem {
  platform: AgentType;
  displayName: string;
  commandNames: string[];
  npmPackage?: string;
  pipxPackage?: string;
  brewCask?: string;
  wingetId?: string;
  manualReason?: string;
}

/** 返回 13 个平台完整目录（顺序与 AGENT_TYPES 一致） */
export function listPlatformCatalog(): PlatformCatalogItem[] {
  return AGENT_TYPES.map((p) => {
    const s = getInstallSpec(p);
    return {
      platform: p,
      displayName: PLATFORM_DISPLAY_NAMES[p] ?? p,
      commandNames: s.commandNames,
      npmPackage: s.npmPackage,
      pipxPackage: s.pipxPackage,
      brewCask: s.brewCask,
      wingetId: s.wingetId,
      manualReason: s.manualReason,
    };
  });
}
