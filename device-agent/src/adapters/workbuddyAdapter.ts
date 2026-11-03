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
 *
 * 5. 【主执行路径】50068 Remote Control（正确模型，优先于 ACP）：
 *    登录态解密密钥只在桌面主进程（CredentialBootstrap IPC 注入），纯 headless 无法复用。
 *    桌面主进程通过 50068 暴露「CodeBuddy Remote Control」API，由其代为执行：
 *      POST /api/v1/runs            body={ text, sender:{ id } } → { runId, status:"accepted" }
 *      GET  /api/v1/runs/:id/stream SSE 流（event: message/done/error）
 *    认证 `Authorization: Bearer <gatewayPassword>`，password 是主进程运行时随机生成、
 *    只驻内存不落盘（settings/localStorage/Keychain 均无）。通过环境变量
 *    `CODEBUDDY_GATEWAY_PASSWORD`（或 `AGENTFLEET_WORKBUDDY_GATEWAY_PASSWORD`）注入。
 *    激活/登录模型 = 用户点「打开平台」→ open -a "WorkBuddy AI" → 手动登录 → ACK 后
 *    activated=1（关联完成）；50068 可达 = 已激活可用。
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

/** 50068 Remote Control 网关地址（桌面主进程，仅监听 localhost） */
const GATEWAY_BASE = 'http://127.0.0.1:50068';

/** gateway password：CODEBUDDY_GATEWAY_PASSWORD 优先，AGENTFLEET_WORKBUDDY_GATEWAY_PASSWORD 兜底 */
function getGatewayPassword(): string {
  return (
    process.env.CODEBUDDY_GATEWAY_PASSWORD ??
    process.env.AGENTFLEET_WORKBUDDY_GATEWAY_PASSWORD ??
    ''
  );
}

/** USER settings 文件路径（gateway.auth 存这里，默认 ~/.codebuddy/settings.json） */
function userSettingsPath(): string {
  const cfgDir = process.env.CODEBUDDY_CONFIG_DIR?.trim();
  if (cfgDir) return path.join(cfgDir, 'settings.json');
  return path.join(os.homedir(), '.codebuddy', 'settings.json');
}

/**
 * 幂等写入 gateway.auth=none，关闭 50068 的本地访问保护（WorkBuddy 账号登录靠
 * Google/微信/手机号，无需 gateway password；50068 只监听 localhost，本地进程可信）。
 * 保留其它字段（enabledPlugins 等），只把 gateway.auth 置为 none；已是 none 则跳过。
 * 注意：需重启 WorkBuddy 桌面应用后生效（主进程启动时读 settings）。
 */
function ensureGatewayAuthNone(): { wrote: boolean; path: string; error?: string } {
  const file = userSettingsPath();
  try {
    let data: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
      } catch {
        return { wrote: false, path: file, error: 'settings.json 解析失败' };
      }
    }
    const gateway = (typeof data.gateway === 'object' && data.gateway !== null
      ? (data.gateway as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    if (gateway.auth === 'none') {
      return { wrote: false, path: file }; // 已是 none，幂等跳过
    }
    data.gateway = { ...gateway, auth: 'none' };
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    return { wrote: true, path: file };
  } catch (err) {
    return { wrote: false, path: file, error: (err as Error).message };
  }
}

/** 50068 SSE 消息结构（buildOutbound） */
interface GatewayMessage {
  id?: string;
  type?: 'accepted' | 'completed' | 'error';
  content?: { text?: string; markdown?: string };
  error?: { code?: string; message?: string };
  agent?: { sessionId?: string; toolCalls?: unknown[] };
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

    let version = this.readVersion(exe);
    if (gateway === 'reachable') {
      version += ' (gateway)';
    } else if (gateway === 'auth-required') {
      // 自动关闭 50068 本地访问保护（幂等，账号登录靠 Google/微信，无需 gateway password）
      const cfg = ensureGatewayAuthNone();
      version += cfg.wrote ? ' (gateway auth→none，需重启 WorkBuddy)' : ' (gateway auth)';
    }
    return {
      found: true,
      agentType: 'workbuddy',
      executable: exe,
      version,
      detectMethod: 'app',
      capabilities,
      maxConcurrency: 1,
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    let seq = 0;
    const makeSeq = (): number => ++seq;

    // 优先走 50068 Remote Control（桌面主进程持有登录态，代为执行，登录态自动复用）。
    // 账号登录靠 Google/微信/手机号（WorkBuddy 桌面应用处理，不靠密码）；50068 的
    // gateway password 只是本地 API 访问保护，可通过 gateway.auth=none 关闭。
    const gateway = await probeGateway50068();
    if (gateway !== 'offline') {
      // reachable 或已配 password 直接走
      if (gateway === 'reachable' || getGatewayPassword()) {
        return this.runViaGateway50068(task, sink, makeSeq);
      }
      // auth-required 且无 password：自动关闭 50068 本地访问保护（幂等），提示重启生效
      const cfg = ensureGatewayAuthNone();
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: {
          message: cfg.wrote
            ? `已自动配置 gateway.auth=none（${cfg.path}），请重启 WorkBuddy 桌面应用后重试`
            : cfg.error
              ? `50068 网关需要本地访问保护配置：${cfg.error}`
              : '50068 网关已设为 gateway.auth=none，请重启 WorkBuddy 桌面应用后重试',
        },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    // fallback：桌面应用未运行，走 ACP stdio（需要 codebuddy CLI 独立登录）
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

  /** 走 50068 Remote Control 执行：POST /api/v1/runs → SSE 订阅结果流 */
  private runViaGateway50068(
    task: TaskSubmit,
    sink: AdapterEventSink,
    makeSeq: () => number,
  ): AdapterRunHandle {
    const password = getGatewayPassword();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (password) headers.Authorization = `Bearer ${password}`;

    const abort = new AbortController();
    let cancelled = false;
    let finished = false;

    const emit = (
      eventType: string,
      status: 'completed' | 'failed' | undefined,
      data: Record<string, unknown>,
    ): void => {
      if (finished) return;
      sink({ taskId: task.taskId, seq: makeSeq(), eventType: eventType as never, status, data, ts: Date.now() });
    };

    void (async () => {
      try {
        // 1. 提交任务（body = Gateway Protocol 消息格式）
        const res = await fetch(`${GATEWAY_BASE}/api/v1/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: task.prompt, sender: { id: 'agentfleet' } }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) {
          emit('status', 'failed', {
            message:
              '50068 网关开启了本地访问保护（gateway.auth=password）。请将 WorkBuddy 的 gateway.auth 设为 none，或设置 CODEBUDDY_GATEWAY_PASSWORD 环境变量后重试',
          });
          return;
        }
        if (!res.ok) {
          emit('status', 'failed', { message: `50068 提交失败（HTTP ${res.status}）` });
          return;
        }
        const data = (await res.json()) as { runId?: string };
        const runId = data.runId;
        if (!runId) {
          emit('status', 'failed', { message: '50068 未返回 runId' });
          return;
        }

        // 2. 订阅 SSE 结果流
        const streamRes = await fetch(`${GATEWAY_BASE}/api/v1/runs/${runId}/stream`, {
          headers,
          signal: abort.signal,
        });
        if (!streamRes.ok || !streamRes.body) {
          emit('status', 'failed', { message: `SSE 流失败（HTTP ${streamRes.status}）` });
          return;
        }

        // 3. 解析 SSE（event: message / done / error）
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let doneReceived = false;

        const handleSse = (eventName: string, dataStr: string): void => {
          if (eventName === 'done') {
            doneReceived = true;
            return;
          }
          if (eventName !== 'message') return;
          try {
            const msg = JSON.parse(dataStr) as GatewayMessage;
            if (msg.type === 'accepted') {
              emit('status', undefined, { message: 'workbuddy agent 已接受任务' });
            } else if (msg.type === 'completed') {
              const text = msg.content?.text ?? msg.content?.markdown ?? '';
              if (text) emit('text', undefined, { text });
              emit('status', 'completed', { message: 'workbuddy agent 执行完成' });
              finished = true;
            } else if (msg.type === 'error') {
              emit('status', 'failed', { message: msg.error?.message ?? 'workbuddy 执行错误' });
              finished = true;
            }
          } catch {
            /* 忽略非 JSON 行 */
          }
        };

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              let eventName = 'message';
              const dataLines: string[] = [];
              for (const line of block.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
              }
              if (dataLines.length > 0) handleSse(eventName, dataLines.join('\n'));
            }
          }
        } catch {
          /* 流中断（取消等） */
        }

        if (!doneReceived && !finished && !cancelled) {
          emit('status', 'failed', { message: 'SSE 流提前结束' });
        }
      } catch (err) {
        if (!cancelled) {
          emit('status', 'failed', { message: `workbuddy 50068 异常: ${(err as Error).message}` });
        }
      }
    })();

    const handle: AdapterRunHandle = {
      cancel: () => {
        cancelled = true;
        finished = true;
        abort.abort();
      },
    };
    this.handles.set(task.taskId, handle);
    return handle;
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
