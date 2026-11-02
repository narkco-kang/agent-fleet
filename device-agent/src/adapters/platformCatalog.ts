import type { AgentType } from '@agentfleet/shared';
import type { PlatformProbe } from './detector.js';

/**
 * 平台目录表（数据驱动）：所有已知 AI agent 平台的探测 + 执行配置。
 * 新增平台只需在此追加一条记录，探测/上报/前端展示自动生效，无需改调度核心。
 */

/** 执行方式（真接策略） */
export type RunMode = 'cli-stream' | 'cli-text' | 'acp' | 'unsupported';

/** 平台执行配置：headless 调用方式（真接时由 CatalogAdapter.run 使用） */
export interface RunSpec {
  mode: RunMode;
  /** headless 参数模板，{prompt} 占位（如 ['-p', '{prompt}']） */
  args?: string[];
  /** stream-json 输出（每行一个 JSON 事件） */
  streamJson?: boolean;
  /** 整段 stdout 作为结果文本（进程退出后一次性发） */
  textOutput?: boolean;
  /** 未接入/待验证的说明（mode='unsupported' 时，诚实口径） */
  note?: string;
}

export interface PlatformDef extends PlatformProbe {
  displayName: string;
  capabilities: string[];
  maxConcurrency: number;
  /** 执行配置（缺省 = unsupported，run 走占位失败并附说明） */
  runSpec?: RunSpec;
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
    runSpec: { mode: 'cli-text', args: ['exec', '{prompt}'], textOutput: true, note: 'codex exec 单轮（待实机验证）' },
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
    runSpec: { mode: 'cli-stream', args: ['-p', '{prompt}', '--output-format', 'stream-json'], streamJson: true, note: 'claude -p stream-json（待实机验证）' },
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
    runSpec: { mode: 'unsupported', args: ['headless', '{prompt}'], note: '逆向确认 dsh headless 单轮可行（ELECTRON_RUN_AS_NODE=1 跑 harness-node-entry + lib/bin.js）；需登录 credentials + profile 配 agent-loop，待专用 DshAdapter' },
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
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'cursor-agent -p headless（print 模式，--force 允许改文件，待实机验证）' },
  },
  {
    agentType: 'aider',
    displayName: 'Aider',
    commands: ['aider'],
    defaultDirs: ['.local/bin/aider'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['--message', '{prompt}', '--no-git', '--yes'], textOutput: true, note: 'aider --message 单轮（无 headless agent 循环）' },
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
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'gemini -p 单轮（待实机验证）' },
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
    runSpec: { mode: 'unsupported', note: 'headless/print 参数待确认' },
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
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'qwen -p print 模式（v0.3+ 支持 stream-json，待实机验证）' },
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
    runSpec: { mode: 'unsupported', note: 'headless/print 参数待确认' },
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
    runSpec: { mode: 'unsupported', note: '支持 ACP（kimi acp，类似 grok agent stdio），待泛化 acpClient 接入' },
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
    runSpec: { mode: 'cli-text', args: ['run', '{prompt}'], textOutput: true, note: 'opencode run 非交互单轮（待实机验证）' },
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
    runSpec: { mode: 'unsupported', note: 'GUI/Cascade 为主，headless CLI 方式待确认（windsurf CLI 存在但 print/headless 参数未证实）' },
  },
  {
    agentType: 'workbuddy',
    displayName: 'WorkBuddy (CodeBuddy)',
    commands: ['codebuddy', 'cbc'],
    // codebuddy 二进制藏在 Electron app 内部（不在标准 PATH），macOS 绝对路径探测
    defaultDirs: ['/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'],
    appNames: ['WorkBuddy AI'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'codebuddy -p 单轮（headless 已确认 --print/--output-format stream-json，待实机验证）' },
  },
];

/** 按 agentType 查平台定义 */
export function findPlatformDef(agentType: AgentType): PlatformDef | undefined {
  return PLATFORM_CATALOG.find((p) => p.agentType === agentType);
}
