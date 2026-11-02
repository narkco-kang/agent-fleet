import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { runAcpPrompt } from '../runner/acpClient.js';

/**
 * WorkBuddy Adapter（真接，ACP 协议）——逆向 WorkBuddy.app 定位到的真正智能体内核。
 *
 * 逆向结论（类比 DshAdapter 的 Electron 逆向，工具：rizin/ghidra/strings + asar 解包）：
 *
 * 1. WorkBuddy.app 的 agent 内核不是通用 codebuddy，而是一个**专属精简 bundle**：
 *    app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs（"wb" = WorkBuddy，rspack 打包）。
 *    它与通用 bundle 的区别：
 *    - 内置 `WORKBUDDY_TOOLS`（`@genie/agent-harness/cli/server.mjs` 中导出）。
 *    - 内置 WorkBuddy 专属多模型网关（deepseek-v4.1-flash-sg / gpt-6-astra / grok-4.7 /
 *      gemini-3.8-flash / glm-5.3 / kimi-k3.1-pro …）。
 *    - 剔除 TUI 视图 / LSP / update / record-replay / channel 等 WorkBuddy 结构性不用的桶。
 *
 * 2. 三个 bundle 变体由引导脚本 `cli/bin/codebuddy` 分派：
 *    - 默认            → dist/codebuddy（通用 TUI）
 *    - FORCE_HEADLESS  → dist/codebuddy-headless（通用 headless）
 *    - FORCE_LITE_WB   → dist/codebuddy-lite-wb.mjs（**WorkBuddy 专属**，优先级最高）
 *    分派开关是环境变量 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`。**必须设**，否则走通用
 *    bundle 读的是 `~/.codebuddy` 的 codebuddy 登录态，会卡 `Authentication required`。
 *
 * 3. 登录态（关键，之前 /login 卡点的根因）：
 *    lite-wb bundle 硬编码读取 WorkBuddy 桌面登录态：
 *      ~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop-ai.info
 *    token 字段为 `{ $wbEncrypted:1, envelope }` 加密包装，lite-wb 内置 Keychain 解密逻辑，
 *    headless 下可复用 GUI 已登录态，无需 codebuddy login。
 *
 * 4. 进入 ACP stdio 的正确姿势（实测）：
 *      CODEBUDDY_FORCE_LITE_WB_BUNDLE=1 codebuddy --serve --acp --port <p> --auth none
 *    关键点：
 *    - 只加 `--acp` 会同时起 HTTP server，默认复用固定端口 50068，
 *      与常驻的 WorkBuddy 桌面应用冲突 → `EADDRINUSE` 直接退出；必须显式给随机 --port。
 *    - `--serve --acp` 组合才会在 stdio 上跑 ACP；`--acp-transport` 默认 stdio。
 *    - `--auth none` 只关掉 HTTP server 的密码，不影响 ACP stdio。
 *    - 启动后要先做约 6-9s 的配置同步（SetupGalileo/pull config）才响应 initialize。
 *    - 复用 WorkBuddy 桌面登录态，不需要（且不能）走 ACP authenticate —— 该调用返回 Internal error。
 *    - 设置 HTTP(S)_PROXY 环境变量会让其内部 setProxy 抛
 *      `Right-hand side of 'instanceof' is not callable` 而无法启动，故默认剥离。
 */

/** 触发 WorkBuddy 专属 lite-wb bundle（而非通用 codebuddy bundle）的环境变量 */
const FORCE_LITE_WB_ENV = 'CODEBUDDY_FORCE_LITE_WB_BUNDLE';

/** WorkBuddy.app 内 codebuddy 引导脚本的绝对路径（据此加载 WorkBuddy 专属内核） */
const CODEBUDDY_IN_APP = path.join(
  '/Applications',
  'WorkBuddy AI.app',
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'cli',
  'bin',
  'codebuddy',
);

/**
 * 会触发 codebuddy `setProxy` 崩溃的代理环境变量。
 * 这些是标准代理变量，codebuddy 内部 axios proxy agent 缺实现时会抛
 * `Right-hand side of 'instanceof' is not callable`，导致进程起不来。
 * 设 AGENTFLEET_WORKBUDDY_KEEP_PROXY=1 可保留（已知会让启动失败，仅调试用）。
 */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
];

/** 定位 codebuddy 可执行文件（app 内绝对路径优先，其次 PATH） */
export function findCodebuddy(): string | null {
  const candidates = [
    CODEBUDDY_IN_APP,
    path.join(os.homedir(), 'Applications', 'WorkBuddy AI.app', 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  try {
    const p = execFileSync('which', ['codebuddy'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return p || null;
  } catch {
    return null;
  }
}

/** 随机高位端口：避开 50068 等桌面应用占用的固定端口 */
function randomHighPort(): number {
  return 40000 + Math.floor(Math.random() * 15000);
}

/**
 * 探测 WorkBuddy 桌面主进程的 50068 Remote Control 网关。
 *  - reachable     ：网关在且免认证（可直接远程调用）
 *  - auth-required ：网关在但需要 gateway password（Bearer 认证）
 *  - offline       ：桌面应用未运行（50068 不可达）
 * 50068 可达 = WorkBuddy 桌面应用运行且已登录，是 workbuddy 平台真正可用的判据。
 */
async function probeGateway50068(): Promise<'reachable' | 'auth-required' | 'offline'> {
  try {
    const res = await fetch('http://127.0.0.1:50068/api/v1/health', {
      signal: AbortSignal.timeout(2_000),
    });
    if (res.status === 401 || res.status === 403) return 'auth-required';
    return 'reachable';
  } catch {
    return 'offline';
  }
}

export class WorkbuddyAdapter implements Adapter {
  readonly agentType = 'workbuddy' as const;
  readonly displayName = 'WorkBuddy';
  private handles = new Map<string, AdapterRunHandle>();

  async detect(): Promise<AdapterDetection> {
    const exe = findCodebuddy();
    if (!exe) {
      return {
        found: false,
        agentType: 'workbuddy',
        executable: '',
        version: '',
        detectMethod: 'app',
        capabilities: ['coding', 'reasoning'],
        maxConcurrency: 1,
      };
    }
    const gateway = await probeGateway50068();
    const capabilities: string[] = ['coding', 'reasoning', 'tools'];
    if (gateway !== 'offline') capabilities.push('remote-control');
    return {
      found: true,
      agentType: 'workbuddy',
      executable: exe,
      version: `${this.readVersion(exe)}${gateway === 'reachable' ? ' (gateway)' : gateway === 'auth-required' ? ' (gateway auth)' : ''}`,
      detectMethod: 'app',
      capabilities,
      maxConcurrency: 1,
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    let seq = 0;
    const makeSeq = (): number => ++seq;

    const exe = findCodebuddy();
    if (!exe) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: { message: '未检测到 WorkBuddy 智能体内核（codebuddy 引导脚本缺失）' },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    const port = randomHighPort();
    // 代理变量会让 codebuddy 的 setProxy 抛错而起不来，默认从子进程环境移除
    const unsetEnv =
      process.env.AGENTFLEET_WORKBUDDY_KEEP_PROXY === '1' ? [] : PROXY_ENV_KEYS;

    const handle = runAcpPrompt({
      cmd: exe,
      cwd: process.cwd(),
      prompt: task.prompt,
      // 关键：强制加载 WorkBuddy 专属 lite-wb 内核（而非通用 codebuddy bundle），
      // 这样才会读 WorkBuddy 桌面登录态（CodeBuddyExtension），而非 ~/.codebuddy。
      env: { [FORCE_LITE_WB_ENV]: '1' },
      // --serve --acp 才会在 stdio 上跑 ACP；--port 规避 50068 被桌面应用占用
      spawnArgs: ['--serve', '--acp', '--port', String(port), '--auth', 'none'],
      agentLabel: 'workbuddy',
      // 复用本地登录态；ACP authenticate 会返回 Internal error
      skipAuthenticate: true,
      // 启动后需约 6-9s 完成配置同步才会响应 initialize
      initializeDelayMs: 9_000,
      promptTimeoutMs: 180_000,
      unsetEnv,
      onEvent: (ev) => {
        const ts = Date.now();
        switch (ev.type) {
          case 'text':
            sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'text', data: { text: ev.text }, ts });
            break;
          case 'thinking':
            sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'thinking', data: { text: ev.text }, ts });
            break;
          case 'tool':
            sink({
              taskId: task.taskId,
              seq: makeSeq(),
              eventType: 'tool_call',
              data: { toolName: ev.toolName, toolInput: ev.toolInput as Record<string, unknown> },
              ts,
            });
            break;
          case 'status':
            sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'status', data: { message: ev.message }, ts });
            break;
          case 'done':
            sink({
              taskId: task.taskId,
              seq: makeSeq(),
              eventType: 'status',
              status: 'completed',
              data: { message: 'workbuddy agent 执行完成' },
              ts,
            });
            break;
          case 'error':
            sink({
              taskId: task.taskId,
              seq: makeSeq(),
              eventType: 'status',
              status: 'failed',
              data: { message: ev.message },
              ts,
            });
            break;
        }
      },
    });

    const runHandle: AdapterRunHandle = { cancel: () => handle.cancel() };
    this.handles.set(task.taskId, runHandle);
    return runHandle;
  }

  cancel(taskId: string): void {
    const h = this.handles.get(taskId);
    if (h) {
      h.cancel();
      this.handles.delete(taskId);
    }
  }

  private readVersion(exe: string): string {
    try {
      const out = execFileSync(exe, ['--version'], {
        encoding: 'utf-8',
        timeout: 8_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const m = out.match(/\d+\.\d+\.\d+/);
      return m ? m[0] : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
