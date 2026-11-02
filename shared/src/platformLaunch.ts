import type { AgentType } from './status.js';

/**
 * 平台应用启动命令（纯函数）：用户点击神经图神经元 → 设备侧弹出平台应用，完成登录激活。
 *
 * 单一事实源：各平台的「打开方式」在此维护（GUI 应用名优先，否则 CLI 命令）。
 * device-agent 的 messageHandler 调用本函数生成命令并 detach spawn。
 */

export type LaunchMethod = 'app' | 'cli' | 'unsupported';

export interface LaunchCommand {
  method: LaunchMethod;
  /** 可直接交给 shell 执行的命令 */
  command: string;
  /** 说明 / 不支持原因 */
  note?: string;
}

/** 每个平台的打开方式：GUI 应用名（macOS /Applications、Windows 快捷）或 CLI 命令 */
interface LaunchSpec {
  appNames?: string[];
  cli?: string;
}

const LAUNCH_SPECS: Record<AgentType, LaunchSpec> = {
  codex: { cli: 'codex' },
  claude: { cli: 'claude' },
  dsh: { appNames: ['DSH Desktop'] },
  grok: { cli: 'grok' },
  cursor: { appNames: ['Cursor'], cli: 'cursor-agent' },
  aider: { cli: 'aider' },
  gemini: { cli: 'gemini' },
  cody: { cli: 'cody' },
  qwen: { cli: 'qwen-code' },
  doubao: { cli: 'marscode' },
  kimi: { cli: 'kimi' },
  opencode: { cli: 'opencode' },
  windsurf: { appNames: ['Windsurf'], cli: 'windsurf' },
};

/** 生成在指定 OS 上打开某平台应用的命令 */
export function launchCommandFor(agentType: AgentType, osPlatform: string): LaunchCommand {
  const spec = LAUNCH_SPECS[agentType];
  if (!spec) {
    return { method: 'unsupported', command: '', note: `unknown platform: ${agentType}` };
  }

  const appName = spec.appNames?.[0];
  const cli = spec.cli;

  if (osPlatform === 'darwin') {
    if (appName) return { method: 'app', command: `open -a ${shellQuote(appName)}` };
    if (cli) {
      return {
        method: 'cli',
        command: `osascript -e 'tell application "Terminal" to do script ${shellQuote(cli)}'`,
        note: `在终端中启动 ${cli} 完成登录`,
      };
    }
  }

  if (osPlatform === 'win32') {
    if (appName) return { method: 'app', command: `start "" ${shellQuote(appName)}` };
    if (cli) return { method: 'cli', command: `start cmd /k ${shellQuote(cli)}` };
  }

  // linux 及其它：GUI 应用不做自动打开，CLI 用 x-terminal-emulator 兜底
  if (cli) {
    return {
      method: 'cli',
      command: `x-terminal-emulator -e ${shellQuote(cli)} || xterm -e ${shellQuote(cli)}`,
      note: `在终端中启动 ${cli} 完成登录`,
    };
  }
  if (appName) {
    return { method: 'unsupported', command: '', note: `GUI 应用 ${appName} 需手动打开` };
  }

  return { method: 'unsupported', command: '', note: `no launcher for ${agentType}` };
}

/** 单引号转义（POSIX shell） */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}
