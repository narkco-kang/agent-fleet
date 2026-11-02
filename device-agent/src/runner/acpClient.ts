import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * ACP（Agent Client Protocol）客户端：把 grok 作为「bot/agent」调用。
 *
 * 走 `grok agent stdio`（JSON-RPC 2.0 over stdio），而非 `grok --single`（后者是单轮
 * 模型问答）。完整 agent 循环：initialize → authenticate → session/new →
 * session/prompt → 监听 session/update 流（思考/工具/文本/计划）→ done。
 *
 * 这样 AgentMesh 调用的才是「grok bot」这一 agent 平台，而不是「grok 模型」。
 */

export interface AcpEvent {
  type: 'text' | 'thinking' | 'tool' | 'status' | 'done' | 'error';
  text?: string;
  message?: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface AcpRunHandle {
  cancel(): void;
  /** 进程退出时 resolve */
  done: Promise<{ code: number | null }>;
}

interface AcpOptions {
  cmd: string;
  cwd?: string;
  prompt: string;
  env?: Record<string, string>;
  /** XAI_API_KEY（有则走 api_key 认证，否则走本机缓存登录态 / 浏览器登录） */
  apiKey?: string;
  onEvent: (ev: AcpEvent) => void;
}

/** 单条 JSON-RPC 消息（请求/响应/通知） */
interface RpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  params?: Record<string, unknown>;
}

const STEP_TIMEOUT_MS = 30_000;
/** authenticate 用 OAuth（grok.com）未登录时会挂起等浏览器授权，headless 下设短超时 */
const AUTH_TIMEOUT_MS = 15_000;

export function runAcpPrompt(opts: AcpOptions): AcpRunHandle {
  const child = spawn(opts.cmd, ['agent', 'stdio'], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let finished = false;
  const pending = new Map<number, (msg: RpcMessage) => void>();

  /** 终态收尾：发 done/error 事件并关闭进程（幂等） */
  function end(type: 'done' | 'error', message?: string): void {
    if (finished) return;
    finished = true;
    if (type === 'done') opts.onEvent({ type: 'done' });
    else opts.onEvent({ type: 'error', message });
    try {
      child.stdin?.end();
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000).unref();
    } catch {
      /* 已退出 */
    }
  }

  // 逐行读 stdout（JSON-RPC over stdio 每行一条消息）
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: RpcMessage;
    try {
      msg = JSON.parse(trimmed) as RpcMessage;
    } catch {
      return;
    }

    // 响应（带 id）→ 匹配 pending
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const cb = pending.get(msg.id);
      pending.delete(msg.id);
      cb?.(msg);
      return;
    }

    // 通知（无 id，带 method）→ 处理 session/update
    if (typeof msg.id === 'undefined' && msg.method === 'session/update') {
      handleSessionUpdate(msg.params as Record<string, unknown>);
    }
  });

  // stderr → 透传为 status 事件（过滤版本提示等噪音）
  const errRl = readline.createInterface({ input: child.stderr });
  errRl.on('line', (line) => {
    if (!line.trim()) return;
    if (/new version|available|update|warning/i.test(line)) return;
    opts.onEvent({ type: 'status', message: `stderr: ${line}` });
  });

  /** 处理 session/update 通知：映射为规范事件 */
  function handleSessionUpdate(params: Record<string, unknown>): void {
    const update = (params?.update ?? {}) as {
      sessionUpdate?: string;
      content?: { type?: string; text?: string; thinking?: string };
      toolName?: string;
      toolInput?: unknown;
      message?: string;
    };
    const kind = update.sessionUpdate;
    if (!kind) return;

    if (kind === 'done') {
      end('done');
      return;
    }
    if (kind === 'agent_message_chunk') {
      const text = update.content?.text;
      if (text) opts.onEvent({ type: 'text', text });
      const thinking = update.content?.thinking;
      if (thinking) opts.onEvent({ type: 'thinking', text: thinking });
      return;
    }
    if (kind === 'tool_use' || kind === 'tool_call') {
      opts.onEvent({
        type: 'tool',
        toolName: update.toolName ?? update.content?.type,
        toolInput: update.toolInput ?? update.content,
      });
      return;
    }
    if (kind === 'plan') {
      opts.onEvent({ type: 'status', message: 'grok 已生成执行计划' });
      return;
    }
    // 其它 update（permission/error 等）→ status 事件
    const msg = update.message ?? (update.content ? JSON.stringify(update.content) : kind);
    opts.onEvent({ type: 'status', message: msg });
  }

  /** 发送 JSON-RPC 请求并等待响应（带超时） */
  function request(method: string, params: Record<string, unknown>, timeoutMs = STEP_TIMEOUT_MS): Promise<RpcMessage> {
    const id = nextId++;
    return new Promise<RpcMessage>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, error: { code: -1, message: `${method} 超时` } });
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  // ===== 启动状态机（异步，不阻塞 run 返回）=====
  void (async () => {
    try {
      // 1) initialize
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { terminal: true },
      });
      if (init.error) {
        end('error', `grok agent 初始化失败: ${init.error.message}`);
        return;
      }
      const initResult = init.result as {
        authMethods?: Array<{ id: string; name?: string }>;
        _meta?: { agentVersion?: string; modelState?: { currentModelId?: string } };
      };
      const authMethodId = opts.apiKey
        ? 'xai.api_key'
        : (initResult.authMethods?.[0]?.id ?? 'grok.com');
      const model = initResult._meta?.modelState?.currentModelId ?? '';

      // 2) authenticate（未登录时 OAuth 会挂起等浏览器，设短超时）
      const auth = await request('authenticate', { methodId: authMethodId }, AUTH_TIMEOUT_MS);
      if (auth.error) {
        end('error', `grok 未登录（认证${auth.error.code === -1 ? '超时' : '失败'}）：${auth.error.message}。请在本机执行 \`grok login\` 完成登录后重试`);
        return;
      }

      // 3) session/new
      const snew = await request('session/new', {
        cwd: opts.cwd ?? process.cwd(),
        mcpServers: [],
      });
      if (snew.error) {
        end('error', `grok 创建会话失败: ${snew.error.message}`);
        return;
      }
      const sessionId = (snew.result as { sessionId?: string })?.sessionId ?? '';

      // 4) session/prompt
      const pr = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: opts.prompt }],
      });
      if (pr.error) {
        end('error', `grok 提交任务失败: ${pr.error.message}`);
        return;
      }

      opts.onEvent({
        type: 'status',
        message: `grok bot 已启动${model ? `（模型 ${model}）` : ''}`,
      });
      // 后续由 session/update 通知流驱动；done 时 end('done')
    } catch (err) {
      end('error', `grok agent 异常: ${(err as Error).message}`);
    }
  })();

  child.on('error', (err) => {
    end('error', `子进程启动失败: ${err.message}`);
  });

  // 进程异常退出且尚未 done/error → 视为失败
  child.on('close', (code) => {
    if (!finished) {
      end('error', `grok 进程异常退出（码 ${code}）`);
    }
  });

  let cancelled = false;
  return {
    done: new Promise((resolve) => {
      child.on('close', (code) => resolve({ code }));
    }),
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      end('error', '任务已取消');
    },
  };
}
