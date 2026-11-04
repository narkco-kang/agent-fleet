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
  /** ACP 启动参数（mode='acp' 时，让该 CLI 进入 ACP stdio，如 kimi 为 ['acp']、grok 为 ['agent','--always-approve','stdio']） */
  spawnArgs?: string[];
  /** ACP 模式：跳过 authenticate（复用本地登录态，authenticate 会报错的平台） */
  skipAuthenticate?: boolean;
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
    runSpec: { mode: 'cli-text', args: ['exec', '{prompt}', '--skip-git-repo-check'], textOutput: true, note: 'codex exec 单轮（--skip-git-repo-check 允许非 git 目录）' },
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
    runSpec: { mode: 'cli-stream', args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose'], streamJson: true, note: 'claude -p stream-json（实机验证：--output-format=stream-json 需 --verbose，否则报错）' },
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
    displayName: 'Kimi Code CLI',
    commands: ['kimi', 'kimi-code'],
    defaultDirs: ['.local/bin/kimi', '.kimi/bin/kimi'],
    npmPackages: ['@moonshot-ai/kimi-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'acp', spawnArgs: ['acp'], note: 'kimi acp 走 ACP（开箱即用，需先 kimi /login 登录）；旧版 kimi-cli(PyPI)已归档，新版 npm 包 @moonshot-ai/kimi-code' },
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
    displayName: 'WorkBuddy',
    commands: ['codebuddy', 'cbc'],
    // WorkBuddy 专属智能体内核由 codebuddy 引导脚本加载（CODEBUDDY_FORCE_LITE_WB_BUNDLE=1
    // → codebuddy-lite-wb.mjs）。引导脚本藏在 Electron app 内部（不在标准 PATH）。
    defaultDirs: ['/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'],
    appNames: ['WorkBuddy AI'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: {
      mode: 'unsupported',
      note: '真接由专用 WorkbuddyAdapter 负责（CODEBUDDY_FORCE_LITE_WB_BUNDLE=1 + --serve --acp 走 ACP stdio，复用 WorkBuddy 桌面登录态）；此目录项仅保留探测信息',
    },
  },
];

/** 按 agentType 查平台定义 */
export function findPlatformDef(agentType: AgentType): PlatformDef | undefined {
  return PLATFORM_CATALOG.find((p) => p.agentType === agentType);
}
