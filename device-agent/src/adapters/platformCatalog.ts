import type { AgentType } from '@agentfleet/shared';
import type { PlatformProbe } from './detector.js';

/**
 * 平台目录表（数据驱动）：所有已知 AI agent 平台的探测配置。
 * 新增平台只需在此追加一条记录，探测/上报/前端展示自动生效，无需改调度核心。
 */
export interface PlatformDef extends PlatformProbe {
  displayName: string;
  capabilities: string[];
  maxConcurrency: number;
}

export const PLATFORM_CATALOG: PlatformDef[] = [
  {
    agentType: 'codex',
    displayName: 'Codex',
    commands: ['codex'],
    defaultDirs: ['.local/bin/codex', '.codex/bin/codex'],
    npmPackages: ['@openai/codex'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
  },
  {
    agentType: 'claude',
    displayName: 'Claude Code',
    commands: ['claude'],
    defaultDirs: ['.local/bin/claude', '.claude/bin/claude'],
    npmPackages: ['@anthropic-ai/claude-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
  },
  {
    agentType: 'dsh',
    displayName: 'DSH Desktop',
    commands: ['dsh', 'dsh-desktop'],
    defaultDirs: ['.local/bin/dsh'],
    appNames: ['DSH Desktop'],
    versionArgs: ['--version'],
    capabilities: ['shell', 'coding'],
    maxConcurrency: 1,
  },
  {
    agentType: 'cursor',
    displayName: 'Cursor',
    commands: ['cursor', 'cursor-agent'],
    defaultDirs: ['.local/bin/cursor', '.cursor/bin/cursor'],
    appNames: ['Cursor'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
  },
  {
    agentType: 'aider',
    displayName: 'Aider',
    commands: ['aider'],
    defaultDirs: ['.local/bin/aider'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
  },
  {
    agentType: 'gemini',
    displayName: 'Gemini CLI',
    commands: ['gemini'],
    defaultDirs: ['.local/bin/gemini'],
    npmPackages: ['@google/gemini-cli'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
  },
  {
    agentType: 'cody',
    displayName: 'Cody',
    commands: ['cody'],
    defaultDirs: ['.local/bin/cody'],
    npmPackages: ['@sourcegraph/cody'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
  },
  {
    agentType: 'qwen',
    displayName: 'Qwen Code',
    commands: ['qwen', 'qwen-code'],
    defaultDirs: ['.local/bin/qwen', '.qwen/bin/qwen'],
    npmPackages: ['@qwen-code/qwen-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
  },
  {
    agentType: 'doubao',
    displayName: '豆包 MarsCode',
    commands: ['doubao', 'marscode', 'mars-code'],
    defaultDirs: ['.local/bin/doubao', '.local/bin/marscode'],
    npmPackages: ['@bytedance/mars-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
  },
  {
    agentType: 'kimi',
    displayName: 'Kimi CLI',
    commands: ['kimi', 'kimi-cli'],
    defaultDirs: ['.local/bin/kimi'],
    npmPackages: ['kimi-cli'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
  },
  {
    agentType: 'opencode',
    displayName: 'OpenCode',
    commands: ['opencode'],
    defaultDirs: ['.local/bin/opencode'],
    npmPackages: ['opencode-ai'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
  },
  {
    agentType: 'windsurf',
    displayName: 'Windsurf',
    commands: ['windsurf'],
    defaultDirs: ['.local/bin/windsurf', '.codeium/windsurf/bin/windsurf'],
    appNames: ['Windsurf'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
  },
];

/** 按 agentType 查平台定义 */
export function findPlatformDef(agentType: AgentType): PlatformDef | undefined {
  return PLATFORM_CATALOG.find((p) => p.agentType === agentType);
}
