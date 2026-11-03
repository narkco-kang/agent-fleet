import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
 *      POST /api/v1/runs   body={ id, type, text, source:{platform,sender:{id}} } → { runId, status:"accepted" }
 *      GET  /api/v1/runs/:id/stream  SSE 流（event: next → data JSON）
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

/** 从 CODEBUDDY_SERVICE_PROXY_URL 提取 gateway 端口（主进程注入，最可靠） */
function gatewayPortFromEnv(): number | null {
  const url = process.env.CODEBUDDY_SERVICE_PROXY_URL;
  if (url) {
    const m = url.match(/127\.0\.0\.1:(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
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

/** gateway password：CODEBUDDY_GATEWAY_PASSWORD 优先，AGENTFLEET_WORKBUDDY_GATEWAY_PASSWORD 兜底 */
function getGatewayPassword(): string {
  return (
    process.env.CODEBUDDY_GATEWAY_PASSWORD ??
    process.env.AGENTFLEET_WORKBUDDY_GATEWAY_PASSWORD ??
    ''
  );
}

/** 网关 SSE 消息结构（buildOutbound） */
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

    // 网关需要 Bearer password（动态、不落盘，通过 CODEBUDDY_GATEWAY_PASSWORD 环境变量注入）
    const password = getGatewayPassword();
    if (gateway.authRequired && !password) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: {
          message:
            'WorkBuddy 网关需要动态 password 认证（不落盘）。请在 device-agent 环境设置 CODEBUDDY_GATEWAY_PASSWORD 后重试',
        },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    return this.runViaGateway(task, sink, makeSeq, gateway.port);
  }

  /** 走桌面主进程的 Remote Control 网关执行：POST /api/v1/runs → 订阅结果流 */
  private runViaGateway(
    task: TaskSubmit,
    sink: AdapterEventSink,
    makeSeq: () => number,
    port: number,
  ): AdapterRunHandle {
    const base = `http://127.0.0.1:${port}`;
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
        // 1. 提交任务（Gateway Protocol 消息格式：id + type + text + source）
        const res = await fetch(`${base}/api/v1/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            id: `af-${task.taskId}`,
            type: 'text',
            text: task.prompt,
            source: { platform: 'generic', sender: { id: 'agentfleet' } },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401 || res.status === 403) {
          emit('status', 'failed', { message: 'WorkBuddy 网关认证失败（动态 password 不匹配）' });
          return;
        }
        if (!res.ok) {
          emit('status', 'failed', { message: `WorkBuddy 提交失败（HTTP ${res.status}）` });
          return;
        }
        const data = (await res.json()) as { runId?: string; error?: { message?: string } };
        if (data.error) {
          emit('status', 'failed', { message: data.error.message ?? 'WorkBuddy 拒绝请求' });
          return;
        }
        const runId = data.runId;
        if (!runId) {
          emit('status', 'failed', { message: 'WorkBuddy 未返回 runId' });
          return;
        }

        // 2. 订阅结果流（SSE：event next/message → data JSON；event done）
        const streamRes = await fetch(`${base}/api/v1/runs/${runId}/stream`, {
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
          if (eventName !== 'next' && eventName !== 'message') return;
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
          emit('status', 'failed', { message: `workbuddy 网关异常: ${(err as Error).message}` });
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
