import type { AgentType, DeployOS } from '@agentmesh/shared';

/**
 * 安装脚本生成（F1）：按 OS × 平台生成安装脚本骨架。
 * MVP 提供 codex/claude/dsh/grok 四平台骨架（本地回环验证），命令为真实安装方式的最佳努力。
 */

type InstallCommands = Record<DeployOS, string>;

/** 未知 OS 兜底：仅 echo 提示（不执行真实安装） */
function unsupported(os: DeployOS, platform: AgentType): string {
  return `echo "[agentmesh] unsupported os ${os} for ${platform}"`;
}

const INSTALL_COMMANDS: Partial<Record<AgentType, InstallCommands>> = {
  codex: {
    macos: 'npm install -g @openai/codex',
    linux: 'npm install -g @openai/codex',
    windows: 'npm install -g @openai/codex',
    unknown: unsupported('unknown', 'codex'),
  },
  claude: {
    macos: 'npm install -g @anthropic-ai/claude-code',
    linux: 'npm install -g @anthropic-ai/claude-code',
    windows: 'npm install -g @anthropic-ai/claude-code',
    unknown: unsupported('unknown', 'claude'),
  },
  dsh: {
    macos: 'curl -fsSL https://dsh.example/install.sh | bash',
    linux: 'curl -fsSL https://dsh.example/install.sh | bash',
    windows: 'iwr -useb https://dsh.example/install.ps1 | iex',
    unknown: unsupported('unknown', 'dsh'),
  },
  grok: {
    macos: 'curl -fsSL https://grok.example/install.sh | bash',
    linux: 'curl -fsSL https://grok.example/install.sh | bash',
    windows: 'iwr -useb https://grok.example/install.ps1 | iex',
    unknown: unsupported('unknown', 'grok'),
  },
};

/** 生成单个平台的安装命令 */
export function installCommandFor(os: DeployOS, platform: AgentType): string {
  const cmds = INSTALL_COMMANDS[platform];
  if (!cmds) return `echo "unsupported platform: ${platform}"`;
  return cmds[os] ?? unsupported(os, platform);
}

/** 生成验证命令（安装后探测是否可执行） */
export function verifyCommandFor(os: DeployOS, platform: AgentType): string {
  if (os === 'windows') return `where ${platform}`;
  return `command -v ${platform} || echo "not_found"`;
}

/**
 * 生成完整安装脚本。
 * - macos/linux：bash 脚本（echo 分隔标记 + 安装 + 验证）
 * - windows：cmd 脚本（echo + 安装 + 验证）
 */
export function buildInstallScript(os: DeployOS, platforms: AgentType[]): string {
  const lines: string[] = [];
  const marker = (msg: string): string =>
    os === 'windows' ? `echo [agentmesh] ${msg}` : `echo "[agentmesh] ${msg}"`;

  lines.push(marker('agentmesh deploy begin'));
  for (const platform of platforms) {
    lines.push(marker(`installing ${platform}`));
    lines.push(installCommandFor(os, platform));
    lines.push(marker(`verifying ${platform}`));
    lines.push(verifyCommandFor(os, platform));
  }
  lines.push(marker('agentmesh deploy end'));
  return lines.join(os === 'windows' ? '\r\n' : '\n');
}

/** 纯 echo 骨架（无需真实安装，仅验证流程连通） */
export function buildEchoScript(os: DeployOS, platforms: AgentType[]): string {
  const lines: string[] = [];
  for (const platform of platforms) {
    lines.push(`echo "[agentmesh] skeleton install ${platform} on ${os}"`);
  }
  return lines.join(os === 'windows' ? '\r\n' : '\n');
}
