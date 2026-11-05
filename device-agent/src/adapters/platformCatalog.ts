import type { AgentType } from '@agentfleet/shared';
import type { PlatformProbe } from './detector.js';

/**
 * 平台目录表（数据驱动）：所有已知 AI agent 平台的探测 + 执行配置。
 * 新增平台只需在此追加一条记录，探测/上报/前端展示自动生效，无需改调度核心。
 */

/** 执行方式（真接策略） */
export type RunMode = 'cli-stream' | 'cli-text' | 'acp' | 'unsupported';

/**
 * 平台 API 协议（对齐 free_sources 表的 format 字段，供「按协议匹配免费源 + 一键配置模型」）。
 * - openai-chat：OpenAI Chat Completions（qwen/gemini/opencode/aider/cursor 等）
 * - openai-responses：OpenAI Responses API（新版 codex 只认这个 wire_api）
 * - anthropic-messages：Anthropic Messages（claude/kimi 等）
 */
export type ApiProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages';

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
  /** 平台 API 协议（对齐 EchoBird apiProtocol；缺省 []，云端 agent/桌面应用无本地协议） */
  apiProtocol?: ApiProtocol[];
  /** 执行配置（缺省 = unsupported，run 走占位失败并附说明） */
  runSpec?: RunSpec;
  /** 登录授权配置（Device Auth Flow：headless 执行 CLI 登录命令，捕获 URL + code，供看板授权中心用） */
  loginSpec?: LoginSpec;
  /** 一键配置模型的声明式映射（对齐 EchoBird config.json 的 write 映射）；缺省 = 不支持一键配置 */
  modelConfig?: ModelConfigSpec;
}

/**
 * 一键配置模型规格（声明式，对齐 EchoBird config.json）。
 * write 为「配置文件字段路径 → 值模板」，占位符 {model} / {baseUrl} / {apiKey} 由 configureModel 注入。
 * 例：claude 的 settings.json 用 "env.ANTHROPIC_BASE_URL": "{baseUrl}"。
 */
export interface ModelConfigSpec {
  /** 相对 home 的配置文件路径（如 '.claude/settings.json'） */
  configFile: string;
  /** 配置文件格式（决定读写方式） */
  format: 'json' | 'toml';
  /** 字段路径 → 值模板映射（json 用点分路径如 "env.ANTHROPIC_MODEL"，toml 用 "model" / "model_providers.x.base_url"） */
  write: Record<string, string>;
}

/** 登录授权规格（Device Auth Flow） */
export interface LoginSpec {
  /** device-auth 启动参数（如 codex：['login','--device-auth']） */
  args: string[];
  /** 授权 URL 提取正则（缺省用通用 https 链接提取） */
  urlPattern?: RegExp;
  /** 一次性 code 提取正则（缺省用通用 XXXX-XXXX 短码提取） */
  codePattern?: RegExp;
  /** 未配置 loginSpec 时的说明（诚实口径） */
  note?: string;
}

export const PLATFORM_CATALOG: PlatformDef[] = [
  {
    agentType: 'codex',
    apiProtocol: ['openai-responses'],
    displayName: 'Codex',
    commands: ['codex'],
    defaultDirs: ['.local/bin/codex', '.codex/bin/codex'],
    pathsByOS: {
      win32: ['%APPDATA%\\npm\\codex.cmd', '%USERPROFILE%\\scoop\\shims\\codex.exe', '%USERPROFILE%\\.bun\\bin\\codex.exe'],
      darwin: ['/usr/local/bin/codex', '/opt/homebrew/bin/codex', '~/.bun/bin/codex', '~/.local/bin/codex'],
      linux: ['/usr/local/bin/codex', '~/.bun/bin/codex', '~/.local/bin/codex'],
    },
    npmPackages: ['@openai/codex'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['exec', '{prompt}', '--skip-git-repo-check'], textOutput: true, note: 'codex exec 单轮（--skip-git-repo-check 允许非 git 目录）' },
    loginSpec: { args: ['login', '--device-auth'], note: 'codex login --device-auth 输出 URL + one-time code（实机验证）' },
    modelConfig: {
      configFile: '.codex/config.toml',
      format: 'toml',
      write: {
        model: '{model}',
        model_provider: 'agentfleet',
        'model_providers.agentfleet.name': 'AgentFleet Free Source',
        'model_providers.agentfleet.base_url': '{baseUrl}',
        'model_providers.agentfleet.wire_api': 'responses',
        'model_providers.agentfleet.env_key': '{apiKey?}',
      },
    },
  },
  {
    agentType: 'claude',
    apiProtocol: ['anthropic-messages'],
    displayName: 'Claude Code',
    commands: ['claude'],
    defaultDirs: ['.local/bin/claude', '.claude/bin/claude'],
    pathsByOS: {
      win32: ['%APPDATA%\\npm\\claude.cmd', '%USERPROFILE%\\.bun\\bin\\claude.exe', '%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\claude.exe'],
      darwin: ['/usr/local/bin/claude', '/opt/homebrew/bin/claude', '~/.local/bin/claude', '~/.bun/bin/claude'],
      linux: ['/usr/local/bin/claude', '/usr/bin/claude', '~/.local/bin/claude', '~/.bun/bin/claude'],
    },
    npmPackages: ['@anthropic-ai/claude-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-stream', args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose'], streamJson: true, note: 'claude -p stream-json（实机验证：--output-format=stream-json 需 --verbose，否则报错）' },
    loginSpec: { args: ['login'], note: 'claude login 输出授权 URL + code（device auth flow，待实机验证）' },
    modelConfig: {
      configFile: '.claude/settings.json',
      format: 'json',
      write: {
        'env.ANTHROPIC_BASE_URL': '{gatewayUrl}',
        'env.ANTHROPIC_MODEL': '{model}',
        'env.ANTHROPIC_AUTH_TOKEN': '{apiKey}',
      },
    },
  },
  {
    agentType: 'dsh',
    apiProtocol: ['anthropic-messages', 'openai-chat'],
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
    apiProtocol: ['openai-chat'],
    displayName: 'Cursor',
    commands: ['cursor', 'cursor-agent'],
    defaultDirs: ['.local/bin/cursor', '.cursor/bin/cursor'],
    appNames: ['Cursor'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'cursor-agent -p headless（print 模式，--force 允许改文件，待实机验证）' },
    loginSpec: { args: ['login'], note: 'cursor-agent login 浏览器授权（browser flow，待实机验证命令）' },
  },
  {
    agentType: 'aider',
    apiProtocol: ['openai-chat', 'anthropic-messages'],
    displayName: 'Aider',
    commands: ['aider'],
    defaultDirs: ['.local/bin/aider'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['--message', '{prompt}', '--no-git', '--yes'], textOutput: true, note: 'aider --message 单轮（无 headless agent 循环）' },
    loginSpec: { args: [], note: 'aider 无 device-auth，需在设备配置 API key（OPENAI_API_KEY / ANTHROPIC_API_KEY 等 env）' },
  },
  {
    agentType: 'gemini',
    apiProtocol: ['openai-chat'],
    displayName: 'Gemini CLI',
    commands: ['gemini'],
    defaultDirs: ['.local/bin/gemini'],
    npmPackages: ['@google/gemini-cli'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'gemini -p 单轮（待实机验证）' },
    loginSpec: { args: [], note: 'gemini 免费登录通道已停用（2026-06），需配置 GEMINI_API_KEY 环境变量' },
  },
  {
    agentType: 'cody',
    apiProtocol: ['anthropic-messages'],
    displayName: 'Cody',
    commands: ['cody'],
    defaultDirs: ['.local/bin/cody'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
    runSpec: { mode: 'unsupported', note: 'Cody CLI (@sourcegraph/cody-cli) 是 experimental 交互式工具（dist/cody 交互问答），需 SRC_ACCESS_TOKEN；无稳定 headless 单轮模式，真接待上游出正式 headless CLI' },
    loginSpec: { args: [], note: 'cody 无 device-auth；配置 SRC_ACCESS_TOKEN（Sourcegraph access token，api-key 方式）' },
  },
  {
    agentType: 'qwen',
    apiProtocol: ['openai-chat'],
    displayName: 'Qwen Code',
    commands: ['qwen', 'qwen-code'],
    defaultDirs: ['.local/bin/qwen', '.qwen/bin/qwen'],
    npmPackages: ['@qwen-code/qwen-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['-p', '{prompt}'], textOutput: true, note: 'qwen -p print 模式（v0.3+ 支持 stream-json，待实机验证）' },
    loginSpec: { args: [], note: 'qwen 无 device-auth，需 API key（阿里云百炼/魔搭），交互 /auth 配置' },
  },
  {
    agentType: 'doubao',
    apiProtocol: ['openai-chat', 'anthropic-messages'],
    displayName: '豆包 TRAE',
    commands: ['doubao', 'trae', 'marscode', 'mars-code'],
    defaultDirs: ['.local/bin/doubao', '.local/bin/trae', '.local/bin/marscode'],
    appNames: ['TRAE'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    runSpec: { mode: 'unsupported', note: 'TRAE CLI 已发布（字节 AI 编程命令行，对标 Claude Code），headless 非交互参数待实测确认；真接需实测 -p/run 参数' },
    loginSpec: { args: [], note: 'TRAE 登录为手机号/邮箱验证码（交互式，在 TRAE IDE/CLI 内完成），看板走「打开桌面应用」方式' },
  },
  {
    agentType: 'kimi',
    apiProtocol: ['anthropic-messages', 'openai-chat'],
    displayName: 'Kimi Code CLI',
    commands: ['kimi', 'kimi-code'],
    defaultDirs: ['.local/bin/kimi', '.kimi/bin/kimi'],
    pathsByOS: {
      win32: ['%USERPROFILE%\\.kimi-code\\bin\\kimi.exe', '%APPDATA%\\npm\\kimi.cmd'],
      darwin: ['~/.kimi-code/bin/kimi', '/opt/homebrew/bin/kimi', '~/.local/bin/kimi'],
      linux: ['~/.kimi-code/bin/kimi', '/usr/local/bin/kimi', '~/.local/bin/kimi'],
    },
    npmPackages: ['@moonshot-ai/kimi-code'],
    versionArgs: ['--version'],
    capabilities: ['coding', 'reasoning'],
    maxConcurrency: 1,
    // 实机验证（v2.5.0）：kimi acp = ACP stdio（authMethod id='login' 走 terminal device-code flow）；
    // 登录命令是 `kimi login`（非 `/login`），未登录时输出 device-code 授权 URL+code。
    // 已知限制：WorkBuddy 沙箱里 session/new 会因写锁 ~/.kimi-code/.projects-write-lock.lock
    // 被 safe-delete broker 拦截而报 Internal error（环境限制，非本代码 bug）；真实设备/云服务器无沙箱应可正常。
    runSpec: { mode: 'acp', spawnArgs: ['acp'], note: 'kimi acp 走 ACP（需先 kimi login 登录）；旧版 kimi-cli(PyPI)已归档，新版 npm 包 @moonshot-ai/kimi-code' },
    loginSpec: { args: ['login'], note: 'kimi login 走 device-code flow（网页授权 URL+code，未登录时输出）' },
  },
  {
    agentType: 'opencode',
    apiProtocol: ['openai-chat'],
    displayName: 'OpenCode',
    commands: ['opencode'],
    defaultDirs: ['.local/bin/opencode'],
    npmPackages: ['opencode-ai'],
    versionArgs: ['--version'],
    capabilities: ['coding'],
    maxConcurrency: 1,
    runSpec: { mode: 'cli-text', args: ['run', '{prompt}'], textOutput: true, note: 'opencode run 非交互单轮（待实机验证）' },
    loginSpec: { args: ['auth', 'login'], note: 'opencode auth login 授权码模式（打印授权 URL + 授权码，待实机验证命令）' },
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
    runSpec: { mode: 'unsupported', note: 'Windsurf 是 IDE（Cascade 工作流），无官方 headless CLI；第三方 windsurf-cli 只是打开文件的辅助工具，非编码 agent。真接无上游支持' },
  },
  {
    agentType: 'workbuddy',
    apiProtocol: ['openai-chat'],
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
