import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';

/**
 * WorkBuddy Adapter —— 走桌面主进程的「CodeBuddy Remote Control」网关执行。
 *
 * 逆向结论（工具：rizin/ghidra/strings + asar 解包）：
 * 1. WorkBuddy.app 的 agent 内核是专属精简 bundle `cli/dist/codebuddy-lite-wb.mjs`
 *    （"wb"=WorkBuddy），内置 WORKBUDDY_TOOLS + 专属多模型网关。
 * 2. 登录态 token 用 `$wbEncrypted`（AES-GCM）加密，解密密钥只在桌面主进程
 *    （CredentialBootstrap IPC 注入），headless 起 codebuddy 必然卡 `Authentication required`。
 * 3. 因此唯一正路 = 桌面主进程的「CodeBuddy Remote Control」网关，由其代为执行：
 *      启动 daemon（后台执行运行时）→ 向 daemon 会话投递 reply → 轮询 history 取结果：
 *        POST /api/v1/daemon/start                        启动 daemon（若 stopped）
 *        GET  /api/v1/workers                             取 kind=daemon 的 sessionId + endpoint
 *        POST /api/v1/sessions/{id}/reply  body={ text }  投递任务（delivered=true）
 *        GET  /api/v1/sessions/{id}/history               轮询取 requests[].finalReply
 *    注：/api/v1/runs 只「登记」run 不真正执行（jobs 始终为空），勿再用。
 *    关键：网关端口是**动态的**（主进程每次启动随机分配，非固定 50068），password 也是
 *    动态的、不落盘，通过环境变量注入：
 *      CODEBUDDY_GATEWAY_PASSWORD  — Bearer 认证密码
 *      CODEBUDDY_SERVICE_PROXY_URL — http://127.0.0.1:<port>/...（可提取端口）
 *    Adapter 动态发现：① 环境变量 ② 扫描 Electron 监听端口探测 /api/v1/health。
 *
 * 激活/登录模型 = 用户点「打开平台」→ open -a "WorkBuddy AI" → 手动登录（Google/微信/
 * 手机号）→ ACK 后 activated=1；网关可达 = 桌面应用运行且已登录。
 */

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

/**
 * 动态发现 WorkBuddy 桌面主进程的「CodeBuddy Remote Control」网关。
 * 关键：网关端口是**动态的**（主进程每次启动随机分配，不是固定 50068），password 也是
 * 动态的、不落盘，通过环境变量注入（CODEBUDDY_GATEWAY_PASSWORD / CODEBUDDY_SERVICE_PROXY_URL）。
 * 发现顺序：① 环境变量（主进程注入，最可靠）② 扫描 Electron 监听端口探测 /api/v1/health。
 */
interface GatewayInfo {
  port: number;
  /** true = 需要 Bearer password 认证 */
  authRequired: boolean;
}

async function discoverGateway(): Promise<GatewayInfo | null> {
  const port = gatewayPortFromEnv() ?? (await scanGatewayPort());
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return { port, authRequired: res.status === 401 || res.status === 403 };
  } catch {
    return null;
  }
}

/** 从 CODEBUDDY_SERVICE_PROXY_URL 或桥接文件提取 gateway 端口 */
function gatewayPortFromEnv(): number | null {
  const url = process.env.CODEBUDDY_SERVICE_PROXY_URL;
  if (url) {
    const m = url.match(/127\.0\.0\.1:(\d+)/);
    if (m) return Number(m[1]);
  }
  const bridge = readBridge();
  return bridge.port > 0 ? bridge.port : null;
}

/** 扫描 Electron 进程监听的 localhost 端口，探测 /api/v1/health 者即 gateway */
async function scanGatewayPort(): Promise<number | null> {
  let ports: number[] = [];
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    });
    const set = new Set<number>();
    for (const line of out.split('\n')) {
      if (!line.includes('Electron')) continue;
      const m = line.match(/127\.0\.0\.1:(\d+)/);
      if (m) set.add(Number(m[1]));
    }
    ports = Array.from(set);
  } catch {
    /* lsof 不可用时忽略 */
  }
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.status === 401 || res.status === 200) return port;
    } catch {
      /* continue */
    }
  }
  return null;
}

/** 从桥接文件读取 gateway password + 端口（桥接进程由 WorkBuddy 主进程 spawn 时写入） */
function readBridge(): { password: string; port: number } {
  try {
    const file = path.join(os.homedir(), '.workbuddy-ai', 'gateway-bridge.json');
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        password?: string;
        port?: number;
      };
      return { password: raw.password ?? '', port: raw.port ?? 0 };
    }
  } catch {
    /* ignore */
  }
  return { password: '', port: 0 };
}

/** 桥接插件目录（WorkBuddy 插件 cache：<marketplace>/<name>/<version>） */
function bridgePluginDir(): string {
  return path.join(
    os.homedir(),
    '.codebuddy',
    'plugins',
    'cache',
    'agentfleet',
    'agentfleet-bridge',
    '1.0.0',
  );
}

/**
 * 确保 WorkBuddy 桥接插件已安装并启用（幂等）。桥接作为 MCP stdio server 注册为插件，
 * defer_loading:false = WorkBuddy 启动即 spawn 桥接，桥接继承动态 password 写入 bridge 文件。
 * device-agent 探测 workbuddy 时自动安装，用户只需登录 WorkBuddy + 重启。
 */
function ensureBridgeInstalled(): boolean {
  try {
    const pluginDir = bridgePluginDir();
    const bridgeDest = path.join(pluginDir, 'bridge.mjs');
    const pluginJson = path.join(pluginDir, '.codebuddy-plugin', 'plugin.json');

    // 从 device-agent 的 scripts 目录复制桥接脚本（随源码分发）
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeSrc = path.join(here, '..', '..', 'scripts', 'workbuddy-bridge.mjs');
    if (!fs.existsSync(bridgeSrc)) return false;

    // 1. 复制桥接脚本 + 写 plugin.json（幂等）
    fs.mkdirSync(path.dirname(pluginJson), { recursive: true });
    if (!fs.existsSync(bridgeDest)) fs.copyFileSync(bridgeSrc, bridgeDest);
    if (!fs.existsSync(pluginJson)) {
      fs.writeFileSync(
        pluginJson,
        `${JSON.stringify(
          {
            name: 'agentfleet-bridge',
            version: '1.0.0',
            description: 'AgentFleet WorkBuddy 网关桥接：把动态 gateway password 搬运给 device-agent',
            mcpServers: {
              'agentfleet-bridge': {
                command: 'node',
                args: ['${CODEBUDDY_PLUGIN_ROOT}/bridge.mjs'],
                defer_loading: false,
              },
            },
          },
          null,
          2,
        )}\n`,
      );
    }

    // 2. 注册 installed_plugins.json（幂等）
    const installedFile = path.join(os.homedir(), '.codebuddy', 'plugins', 'installed_plugins.json');
    let installed: { version?: number; plugins?: Record<string, unknown[]> } = { version: 2, plugins: {} };
    try {
      installed = JSON.parse(fs.readFileSync(installedFile, 'utf-8')) as typeof installed;
    } catch {
      /* 首次注册 */
    }
    const key = 'agentfleet-bridge@agentfleet';
    const entry = {
      scope: 'user',
      installPath: pluginDir,
      version: '1.0.0',
      installedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    installed.plugins = installed.plugins ?? {};
    const list = (installed.plugins[key] ?? []) as unknown[];
    if (!list.some((e) => (e as { version?: string }).version === '1.0.0')) {
      installed.plugins[key] = [entry, ...list];
      fs.writeFileSync(installedFile, `${JSON.stringify(installed, null, 2)}\n`);
    }

    // 3. 注册 configured-plugins.json（启用，关键：只 installed 不 configured 不会被加载）
    const configuredFile = path.join(os.homedir(), '.workbuddy-ai', 'plugins', 'configured-plugins.json');
    let configured: {
      version?: number;
      builtInMarketPlugins?: Array<{ name?: string; marketplaceName?: string; scope?: string }>;
    } = { version: 1, builtInMarketPlugins: [] };
    try {
      configured = JSON.parse(fs.readFileSync(configuredFile, 'utf-8')) as typeof configured;
    } catch {
      /* 首次注册 */
    }
    const enabledList = configured.builtInMarketPlugins ?? [];
    if (!enabledList.some((p) => p.name === 'agentfleet-bridge')) {
      enabledList.push({ name: 'agentfleet-bridge', marketplaceName: 'agentfleet', scope: 'user' });
      configured.builtInMarketPlugins = enabledList;
      fs.writeFileSync(configuredFile, `${JSON.stringify(configured, null, 2)}\n`);
    }

    return true;
  } catch {
    return false;
  }
}

/** gateway password：环境变量优先，桥接文件兜底（桥接由 WorkBuddy spawn，继承动态 password） */
function getGatewayPassword(): string {
  return (
    process.env.CODEBUDDY_GATEWAY_PASSWORD ??
    process.env.AGENTFLEET_WORKBUDDY_GATEWAY_PASSWORD ??
    readBridge().password
  );
}

/** 简单 sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 确保 daemon 运行（daemon 是 WorkBuddy 的后台执行运行时） */
async function ensureDaemon(base: string, headers: Record<string, string>): Promise<void> {
  try {
    const res = await fetch(`${base}/api/v1/daemon/status`, { headers, signal: AbortSignal.timeout(3_000) });
    const data = (await res.json()) as { data?: { status?: string } };
    if (data.data?.status === 'running') return;
  } catch {
    /* 查状态失败，尝试启动 */
  }
  await fetch(`${base}/api/v1/daemon/start`, { method: 'POST', headers, signal: AbortSignal.timeout(10_000) });
  await sleep(1_500); // 等 daemon 注册 worker
}

/** 从 workers 列表找 kind=daemon 的 worker（含 sessionId + endpoint） */
async function findDaemonWorker(
  base: string,
  headers: Record<string, string>,
): Promise<{ sessionId: string; endpoint?: string } | null> {
  try {
    const res = await fetch(`${base}/api/v1/workers`, { headers, signal: AbortSignal.timeout(5_000) });
    const data = (await res.json()) as {
      data?: Array<{ kind?: string; sessionId?: string; endpoint?: string }>;
    };
    const daemon = data.data?.find((w) => w.kind === 'daemon' && w.sessionId);
    if (daemon?.sessionId) return { sessionId: daemon.sessionId, endpoint: daemon.endpoint };
  } catch {
    /* ignore */
  }
  return null;
}

/** 查询会话的请求历史（含 userInput + finalReply） */
async function sessionRequests(
  base: string,
  sessionId: string,
  headers: Record<string, string>,
): Promise<Array<{ userInput?: string; finalReply?: string }>> {
  try {
    const res = await fetch(`${base}/api/v1/sessions/${sessionId}/history`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json()) as {
      data?: { requests?: Array<{ userInput?: string; finalReply?: string }> };
    };
    return data.data?.requests ?? [];
  } catch {
    return [];
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
    // 自动安装桥接插件（WorkBuddy 启动时 spawn 桥接写 password，供 device-agent 读取）
    ensureBridgeInstalled();
    const gateway = await discoverGateway();
    const capabilities: string[] = ['coding', 'reasoning', 'tools'];
    if (gateway) capabilities.push('remote-control');

    let version = this.readVersion(exe);
    if (gateway) {
      version += gateway.authRequired ? ' (gateway auth)' : ' (gateway)';
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

    // 唯一执行路径 = 桌面主进程的「CodeBuddy Remote Control」网关（动态端口 + 动态 password）。
    const gateway = await discoverGateway();
    if (!gateway) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: {
          message:
            'WorkBuddy 桌面应用未运行（Remote Control 网关不可达）。请打开并登录 WorkBuddy 桌面应用后重试',
        },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    // 网关需要 Bearer password（动态、不落盘，只在 WorkBuddy 主进程注入给其子进程）
    const password = getGatewayPassword();
    if (gateway.authRequired && !password) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: {
          message:
            'WorkBuddy 网关需要动态密码（不落盘）。请从 WorkBuddy 集成终端启动 device-agent（自动继承密码），或设置 CODEBUDDY_GATEWAY_PASSWORD 环境变量后重试',
        },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    return this.runViaReply(task, sink, makeSeq, gateway.port);
  }

  /**
   * 通过 daemon 会话执行（实测唯一可行路径）：
   * 确保 daemon 运行 → 向 daemon 会话投递 reply → 轮询 history 取 finalReply。
   * 注：/api/v1/runs 只「登记」run 不真正执行（jobs 始终为空），正确入口是 session reply。
   */
  private runViaReply(
    task: TaskSubmit,
    sink: AdapterEventSink,
    makeSeq: () => number,
    port: number,
  ): AdapterRunHandle {
    const base = `http://127.0.0.1:${port}`;
    const password = getGatewayPassword();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (password) headers.Authorization = `Bearer ${password}`;

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
        // 1. 确保 daemon 运行（daemon 是后台执行运行时）
        await ensureDaemon(base, headers);
        // 2. 取 daemon 会话（workers 里 kind=daemon 的 worker）
        const daemon = await findDaemonWorker(base, headers);
        if (!daemon?.sessionId) {
          emit('status', 'failed', { message: '未找到 WorkBuddy daemon 会话（daemon 未就绪）' });
          return;
        }
        const daemonBase = daemon.endpoint ?? base;
        const sessionId = daemon.sessionId;

        // 3. 记录投递前的请求数（用于检测新结果）
        const beforeCount = (await sessionRequests(daemonBase, sessionId, headers)).length;

        // 4. 投递任务
        const replyRes = await fetch(`${daemonBase}/api/v1/sessions/${sessionId}/reply`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: task.prompt }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!replyRes.ok) {
          emit('status', 'failed', { message: `WorkBuddy 投递失败（HTTP ${replyRes.status}）` });
          return;
        }
        const replyData = (await replyRes.json().catch(() => ({}))) as { data?: { delivered?: boolean } };
        if (!replyData.data?.delivered) {
          emit('status', 'failed', { message: 'WorkBuddy 投递未送达（daemon 会话不可用）' });
          return;
        }
        emit('status', undefined, { message: 'workbuddy 已投递任务' });

        // 5. 轮询 history 取结果（出现新的 finalReply）
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline && !cancelled) {
          await sleep(3_000);
          const requests = await sessionRequests(daemonBase, sessionId, headers);
          if (requests.length > beforeCount) {
            const latest = requests[requests.length - 1];
            if (latest?.finalReply) {
              emit('text', undefined, { text: latest.finalReply });
              emit('status', 'completed', { message: 'workbuddy 执行完成' });
              finished = true;
              return;
            }
          }
        }
        if (!cancelled && !finished) {
          emit('status', 'failed', { message: 'workbuddy 执行超时（3 分钟内未返回结果）' });
        }
      } catch (err) {
        if (!cancelled) {
          emit('status', 'failed', { message: `workbuddy 异常: ${(err as Error).message}` });
        }
      }
    })();

    const handle: AdapterRunHandle = {
      cancel: () => {
        cancelled = true;
        finished = true;
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
