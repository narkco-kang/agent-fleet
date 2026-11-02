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
  /** 需要从子进程环境中移除的键（如会触发上游 CLI 崩溃的代理变量） */
  unsetEnv?: string[];
  /** XAI_API_KEY（有则走 api_key 认证，否则走本机缓存登录态） */
  apiKey?: string;
  /**
   * grok 的自定义 agent（bot）名，如 explore/plan/reviewer。
   * 不传 = 走 general-purpose 主 agent，由 grok 自行委派子代理（subagents 默认开启）。
   */
  agentProfile?: string;
  /**
   * 平台启动参数（决定如何让该 CLI 进入 ACP stdio 模式）。
   * 缺省为 grok：['agent', '--always-approve', 'stdio']。
   * 其他平台各不相同，例如 codebuddy：['--serve', '--acp', '--port', '<p>', '--auth', 'none']。
   */
  spawnArgs?: string[];
  /** 平台显示名，用于状态/错误消息（缺省 'grok'） */
  agentLabel?: string;
  /**
   * 跳过 authenticate 步骤。
   * grok 必须先 authenticate 才能用模型；codebuddy 的 ACP authenticate 会返回
   * Internal error，它直接复用本地 CLI 登录态，因此跳过。
   */
  skipAuthenticate?: boolean;
  /** 多等一段时间再发 initialize（某些 CLI 启动要做配置同步，如 codebuddy 约 6-9s） */
  initializeDelayMs?: number;
  /** session/prompt 的等待上限（思考久的平台可调大，缺省 STEP_TIMEOUT_MS*4） */
  promptTimeoutMs?: number;
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
/** 分层静默超时：不同阶段容忍的「无事件」时长不同 */
const IDLE_ANSWER_MS = 8_000; // 最终回答后：很快静默
const IDLE_THINKING_MS = 15_000; // 思考中：留缓冲
const IDLE_TOOL_MS = 60_000; // 工具执行中：命令可能较慢
const IDLE_SUBAGENT_MS = 300_000; // 等待后台子代理（grok 自行委派）时：子代理可能跑很久

/** grok 进入 ACP stdio 的默认参数 */
const GROK_SPAWN_ARGS = ['agent', '--always-approve', 'stdio'];

export function runAcpPrompt(opts: AcpOptions): AcpRunHandle {
  // --always-approve：跳过工具权限确认（grok 默认对 write/edit 等工具发 session/request_permission
  // 等客户端 approve，headless 下会卡住；--always-approve 让其自动批准，工具直接执行）
  const spawnArgs = opts.spawnArgs ?? GROK_SPAWN_ARGS;
  const label = opts.agentLabel ?? 'grok';
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  for (const k of opts.unsetEnv ?? []) delete childEnv[k];
  const child = spawn(opts.cmd, spawnArgs, {
    cwd: opts.cwd ?? process.cwd(),
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let finished = false;
  const pending = new Map<number, (msg: RpcMessage) => void>();
  let idleTimer: NodeJS.Timeout | null = null;
  // grok 自行委派：主 agent spawn 后台子代理后，会静默等待子代理返回（子代理可能跑数分钟）。
  // 一旦检测到委派，后续静默超时放宽到 IDLE_SUBAGENT_MS，直到主 agent 开始输出最终回答。
  let subagentActive = false;

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
  function touchIdle(timeoutMs: number): void {
    if (idleTimer) clearTimeout(idleTimer);
    // 委派等待期间，无论当前阶段都放宽到长超时，避免子代理未返回就被误判结束
    const eff = subagentActive ? IDLE_SUBAGENT_MS : timeoutMs;
    idleTimer = setTimeout(() => end('done'), eff);
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

  // stderr → status（过滤版本提示与插件加载等噪音）
  const errRl = readline.createInterface({ input: child.stderr });
  errRl.on('line', (line) => {
    if (!line.trim()) return;
    if (/new version|available|update|warning|mods: loaded/i.test(line)) return;
    opts.onEvent({ type: 'status', message: `stderr: ${line}` });
  });

  function handleSessionUpdate(params: Record<string, unknown>): void {
    const update = (params?.update ?? {}) as {
      sessionUpdate?: string;
      content?: { type?: string; text?: string };
      title?: string;
      rawInput?: unknown;
      toolInput?: unknown;
      input?: unknown;
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
          subagentActive = false; // 主 agent 开始输出最终回答 = 子代理已返回
          opts.onEvent({ type: 'text', text });
          touchIdle(IDLE_ANSWER_MS);
        }
        return;
      }
      case 'agent_thought_chunk': {
        const text = update.content?.text;
        if (text) {
          opts.onEvent({ type: 'thinking', text });
          touchIdle(IDLE_THINKING_MS);
        }
        return;
      }
      case 'tool_call': {
        // grok 的工具名在 title（如 "search_replace"），输入在 rawInput
        const toolName = update.title ?? 'tool';
        // 委派子代理：grok 主 agent 自行 spawn 子 agent（explore/plan 等）并行处理
        const isSubagentSpawn = /spawn_subagent|tasktool|subagent/i.test(toolName);
        if (isSubagentSpawn) subagentActive = true;
        opts.onEvent({
          type: 'tool',
          toolName: isSubagentSpawn ? 'spawn_subagent' : toolName,
          toolInput: update.rawInput ?? update.toolInput ?? update.input ?? update.content,
        });
        touchIdle(isSubagentSpawn ? IDLE_SUBAGENT_MS : IDLE_TOOL_MS);
        return;
      }
      case 'tool_call_update': {
        // grok 的工具进度描述在 title（如 "Edit `/path/hello.py`"）
        const msg = update.title ?? update.message ?? '';
        if (msg) {
          opts.onEvent({ type: 'status', message: msg });
          touchIdle(IDLE_TOOL_MS);
        }
        return;
      }
      case 'plan':
        opts.onEvent({ type: 'status', message: `${label} 已生成执行计划` });
        touchIdle(IDLE_THINKING_MS);
        return;
      case 'available_commands_update':
      case 'session_info_update':
      case 'config_option_update':
      case 'usage_update':
        return; // 元数据（可用命令/会话信息/配置项/token 用量），忽略（不计入静默）
      default: {
        const msg = update.message ?? (update.content ? JSON.stringify(update.content) : kind);
        opts.onEvent({ type: 'status', message: msg });
        touchIdle(IDLE_THINKING_MS);
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
      // 部分 CLI 启动后要先做配置同步/预热，过早发 initialize 会被忽略
      if (opts.initializeDelayMs && opts.initializeDelayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.initializeDelayMs));
      }
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { terminal: true },
      });
      if (init.error) {
        end('error', `${label} agent 初始化失败: ${init.error.message}`);
        return;
      }
      const initResult = init.result as {
        authMethods?: Array<{ id: string; name?: string }>;
        _meta?: { agentVersion?: string; modelState?: { currentModelId?: string } };
      };
      const model = initResult._meta?.modelState?.currentModelId ?? '';

      // 认证：grok 必须显式 authenticate；codebuddy 复用本地登录态且 authenticate 会报 Internal error
      if (!opts.skipAuthenticate) {
        const authMethodId = opts.apiKey
          ? 'xai.api_key'
          : (initResult.authMethods?.[0]?.id ?? 'grok.com');

        const auth = await request('authenticate', { methodId: authMethodId }, AUTH_TIMEOUT_MS);
        if (auth.error) {
          end(
            'error',
            `${label} 未登录（认证${auth.error.code === -1 ? '超时' : '失败'}）：${auth.error.message}。请在本机执行 \`${label} login\` 完成登录后重试`,
          );
          return;
        }
      }

      const snew = await request('session/new', {
        cwd: opts.cwd ?? process.cwd(),
        mcpServers: [],
        ...(opts.agentProfile ? { agentProfile: opts.agentProfile } : {}),
      });
      if (snew.error) {
        end('error', `${label} 创建会话失败: ${snew.error.message}`);
        return;
      }
      const sessionId = (snew.result as { sessionId?: string })?.sessionId ?? '';

      const pr = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: opts.prompt }],
      }, opts.promptTimeoutMs ?? STEP_TIMEOUT_MS * 4);
      if (pr.error) {
        end('error', `${label} 提交任务失败: ${pr.error.message}`);
        return;
      }
      // ACP 用 stopReason 表达终态；refusal 通常意味着模型层认证/额度失败
      const stopReason = (pr.result as { stopReason?: string; _meta?: Record<string, unknown> } | undefined)
        ?.stopReason;
      if (stopReason === 'refusal') {
        const rawErr = (pr.result as { _meta?: Record<string, unknown> })?._meta?.[
          'codebuddy.ai/errorMessage'
        ];
        let detail = '';
        try {
          detail = rawErr ? (JSON.parse(String(rawErr)) as { data?: { details?: string } }).data?.details ?? '' : '';
        } catch {
          detail = rawErr ? String(rawErr) : '';
        }
        end(
          'error',
          `${label} 拒绝了本次请求（模型层未授权）。${detail || '请在本机完成该 CLI 的登录（如 /login）后重试'}`,
        );
        return;
      }

      opts.onEvent({
        type: 'status',
        message: `${label} agent 已启动${model ? `（模型 ${model}）` : ''}`,
      });
      touchIdle(IDLE_THINKING_MS); // 提交后启动静默定时器，等待开始输出
    } catch (err) {
      end('error', `${label} agent 异常: ${(err as Error).message}`);
    }
  })();

  child.on('error', (err) => {
    end('error', `子进程启动失败: ${err.message}`);
  });
  child.on('close', (code) => {
    if (!finished) {
      end('error', `${label} 进程异常退出（码 ${code}）`);
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
