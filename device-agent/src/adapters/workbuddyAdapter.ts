import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';

/**
 * WorkBuddy Adapter —— 走桌面主进程的 50068「CodeBuddy Remote Control」执行。
 *
 * 逆向结论（类比 DshAdapter 的 Electron 逆向，工具：rizin/ghidra/strings + asar 解包）：
 *
 * 1. WorkBuddy.app 的 agent 内核是专属精简 bundle `cli/dist/codebuddy-lite-wb.mjs`
 *    （"wb"=WorkBuddy），内置 WORKBUDDY_TOOLS + 专属多模型网关。
 * 2. 登录态 token 用 `$wbEncrypted`（AES-GCM）加密，解密密钥（symmetricKey + RSA 私钥）
 *    只在桌面主进程（CredentialBootstrap IPC 注入），Keychain 无 WorkBuddy Safe Storage。
 *    → **纯 headless 无法解密登录态**，headless 起 codebuddy 必然卡 `Authentication required`。
 * 3. 因此唯一正路 = 桌面主进程的 50068「CodeBuddy Remote Control」，由其代为执行：
 *      POST /api/v1/runs             body={ text, sender:{id} } → { runId, status:"accepted" }
 *      GET  /api/v1/runs/:id/stream  SSE 流（event: message/done/error）
 *    认证 `Authorization: Bearer <gatewayPassword>`；gateway password 只是 50068 的本地
 *    访问保护（可关），可通过 settings 的 `gateway.auth=none` 关闭（本 Adapter 自动写入）。
 *
 * 激活/登录模型 = 用户点「打开平台」→ open -a "WorkBuddy AI" → 手动登录（Google/微信/
 * 手机号）→ ACK 后 activated=1；50068 可达 = 桌面应用运行且已登录，即可执行。
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

    // 唯一执行路径 = 50068 Remote Control（桌面主进程持有登录态代为执行）。
    // 不再 fallback ACP stdio：登录态解密密钥只在桌面主进程，headless 无法复用，
    // 走 ACP 必然卡 Authentication required（此前报错的根因）。
    const gateway = await probeGateway50068();
    if (gateway === 'offline') {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: {
          message:
            'WorkBuddy 桌面应用未运行或未登录（50068 Remote Control 不可达）。请打开并登录 WorkBuddy 桌面应用后重试',
        },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

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
