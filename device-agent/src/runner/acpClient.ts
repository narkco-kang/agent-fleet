import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * ACP（Agent Client Protocol）客户端：把 grok 作为「bot/agent」调用。
 *
 * 走 `grok agent stdio`（JSON-RPC 2.0 over stdio），而非 `grok --single`（后者是单轮
 * 模型问答）。完整 agent 循环：initialize → authenticate → session/new →
 * session/prompt → 监听 session/update 流（思考/工具/文本/计划）→ 静默超时判定回合结束。
 *
 * 实测 grok（1.0.x）session/update 的 sessionUpdate 类型：
 *   agent_thought_chunk（思考）· agent_message_chunk（回答）· tool_call / tool_call_update
 *   · available_commands_update / session_info_update（元数据，忽略）
 * grok 回答完一轮后**不发显式 done**，而是保持连接等下一轮；故用「静默超时」判定单轮完成。
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
  /** XAI_API_KEY（有则走 api_key 认证，否则走本机缓存登录态） */
  apiKey?: string;
  onEvent: (ev: AcpEvent) => void;
}

/** 单条 JSON-RPC 消息 */
interface RpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  params?: Record<string, unknown>;
}

const STEP_TIMEOUT_MS = 30_000;
/** authenticate 未登录时 OAuth 会挂起等浏览器授权，headless 下设短超时 */
const AUTH_TIMEOUT_MS = 15_000;
/** 单轮完成判定：无实质事件持续该时长即视为回合结束 */
const IDLE_DONE_MS = 8_000;

export function runAcpPrompt(opts: AcpOptions): AcpRunHandle {
  const child = spawn(opts.cmd, ['agent', 'stdio'], {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let finished = false;
  const pending = new Map<number, (msg: RpcMessage) => void>();
  let idleTimer: NodeJS.Timeout | null = null;

  /** 终态收尾：发 done/error 事件并关闭进程（幂等） */
  function end(type: 'done' | 'error', message?: string): void {
    if (finished) return;
    finished = true;
    if (idleTimer) clearTimeout(idleTimer);
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

  /** 收到实质事件 → 重置静默定时器（静默超时即判定回合结束） */
  function touchIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => end('done'), IDLE_DONE_MS);
    idleTimer.unref();
  }

  // 逐行读 stdout
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

    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const cb = pending.get(msg.id);
      pending.delete(msg.id);
      cb?.(msg);
      return;
    }
    if (typeof msg.id === 'undefined' && msg.method === 'session/update') {
      handleSessionUpdate(msg.params as Record<string, unknown>);
    }
  });

  // stderr → status（过滤版本提示噪音）
  const errRl = readline.createInterface({ input: child.stderr });
  errRl.on('line', (line) => {
    if (!line.trim()) return;
    if (/new version|available|update|warning/i.test(line)) return;
    opts.onEvent({ type: 'status', message: `stderr: ${line}` });
  });

  function handleSessionUpdate(params: Record<string, unknown>): void {
    const update = (params?.update ?? {}) as {
      sessionUpdate?: string;
      content?: { type?: string; text?: string };
      toolName?: string;
      toolInput?: unknown;
      input?: unknown;
      title?: string;
      message?: string;
    };
    const kind = update.sessionUpdate;
    if (!kind) return;

    switch (kind) {
      case 'done':
        end('done');
        return;
      case 'agent_message_chunk': {
        const text = update.content?.text;
        if (text) {
          opts.onEvent({ type: 'text', text });
          touchIdle();
        }
        return;
      }
      case 'agent_thought_chunk': {
        const text = update.content?.text;
        if (text) {
          opts.onEvent({ type: 'thinking', text });
          touchIdle();
        }
        return;
      }
      case 'tool_call':
        opts.onEvent({
          type: 'tool',
          toolName: update.toolName ?? update.content?.type,
          toolInput: update.toolInput ?? update.input ?? update.content,
        });
        touchIdle();
        return;
      case 'tool_call_update': {
        const msg = update.message ?? (update.content?.text ?? `工具执行中：${update.toolName ?? ''}`).trim();
        if (msg) {
          opts.onEvent({ type: 'status', message: msg });
          touchIdle();
        }
        return;
      }
      case 'plan':
        opts.onEvent({ type: 'status', message: 'grok 已生成执行计划' });
        touchIdle();
        return;
      case 'available_commands_update':
      case 'session_info_update':
        return; // 元数据，忽略（不计入静默）
      default: {
        const msg = update.message ?? (update.content ? JSON.stringify(update.content) : kind);
        opts.onEvent({ type: 'status', message: msg });
        touchIdle();
      }
    }
  }

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

  // ===== 状态机 =====
  void (async () => {
    try {
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

      const auth = await request('authenticate', { methodId: authMethodId }, AUTH_TIMEOUT_MS);
      if (auth.error) {
        end('error', `grok 未登录（认证${auth.error.code === -1 ? '超时' : '失败'}）：${auth.error.message}。请在本机执行 \`grok login\` 完成登录后重试`);
        return;
      }

      const snew = await request('session/new', {
        cwd: opts.cwd ?? process.cwd(),
        mcpServers: [],
        // AgentMesh 任务来自看板，工具执行全自动批准，避免权限确认卡住
        permissionMode: 'bypassPermissions',
      });
      if (snew.error) {
        end('error', `grok 创建会话失败: ${snew.error.message}`);
        return;
      }
      const sessionId = (snew.result as { sessionId?: string })?.sessionId ?? '';

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
      touchIdle(); // 提交后启动静默定时器，等待 grok 开始输出
    } catch (err) {
      end('error', `grok agent 异常: ${(err as Error).message}`);
    }
  })();

  child.on('error', (err) => {
    end('error', `子进程启动失败: ${err.message}`);
  });
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
