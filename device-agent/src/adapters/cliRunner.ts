import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { TaskEvent } from '@agentfleet/shared';
import { buildSandboxCommand, type SandboxProfile } from '../runner/sandbox.js';

/**
 * 通用 CLI 执行器：把「spawn CLI agent + 流式输出 + 终态判定」统一为生命周期状态机。
 *
 * 借鉴 Orca 的统一 agent 进程生命周期（acquisition → initialize → send/turn/result → failure attribution）：
 *   start（启动进程）→ stream（流式输出）→ terminal（终态 + 故障归因）
 *
 * 输出模式：
 *   - stream-json：每行一个 JSON 事件（如 claude --output-format stream-json）
 *   - text：整段 stdout 作为结果文本（如 codex exec / aider --message / gemini -p）
 *   - 默认：逐行作为文本事件
 */

export interface CliRunOptions {
  taskId: string;
  cmd: string;
  args: string[];
  cwd?: string;
  /** 流式 JSON 输出（每行一个 JSON 事件） */
  streamJson?: boolean;
  /** 纯文本输出（整段 stdout 作为结果，进程退出后一次性发） */
  textOutput?: boolean;
  onEvent: (ev: TaskEvent) => void;
  /** 总超时（ms），超时发 failed（timeout 归因） */
  timeoutMs?: number;
  /** 沙箱 profile（P0-2，默认 none） */
  sandbox?: SandboxProfile;
}

export interface CliRunHandle {
  cancel(): void;
}

/**
 * 从 stream-json 事件提取文本，兼容多种平台格式：
 * - 顶层 `text`（codex 等）
 * - claude assistant 事件的 `message.content` 数组里的 text blocks
 * - claude result 事件的 `result` 字段（最终纯文本）
 */
export function extractStreamText(j: {
  type?: string;
  text?: string;
  result?: string;
  message?: { content?: unknown } | string;
}): string {
  // 顶层 text
  if (typeof j.text === 'string' && j.text.trim()) return j.text;
  // claude assistant：message.content 是 blocks 数组，提取 text block
  const msg = j.message;
  if (msg && typeof msg === 'object') {
    const content = msg.content;
    if (Array.isArray(content)) {
      const parts = content
        .filter((c): c is { type?: string; text?: string } => {
          return !!c && (c as { type?: string }).type === 'text';
        })
        .map((c) => (c as { text?: string }).text ?? '');
      if (parts.length) return parts.join('');
    }
  }
  // claude result：result 字段是最终纯文本（不再是 tool_call）
  if (j.type === 'result' && typeof j.result === 'string' && j.result.trim()) return j.result;
  return '';
}

/** 检测 tool 事件（claude assistant 的 tool_use block，或顶层 tool_use） */
export function detectToolUse(j: {
  type?: string;
  message?: { content?: unknown } | string;
}): { name: string; input: unknown } | null {
  const msg = j.message;
  if (msg && typeof msg === 'object' && Array.isArray(msg.content)) {
    const tu = msg.content.find((c) => !!c && (c as { type?: string }).type === 'tool_use') as
      | { name?: string; input?: unknown }
      | undefined;
    if (tu?.name) return { name: tu.name, input: tu.input ?? {} };
  }
  if (j.type === 'tool_use') {
    const anyJ = j as unknown as { name?: string; input?: unknown };
    return { name: anyJ.name ?? 'tool', input: anyJ.input ?? {} };
  }
  return null;
}

export function runCli(opts: CliRunOptions): CliRunHandle {
  // 沙箱包裹（P0-2）：readonly/isolated 时用 sandbox-exec/bwrap 包裹命令
  const { cmd, args } = buildSandboxCommand(opts.sandbox ?? 'none', opts.cmd, opts.args);
  // Windows：npm 全局 CLI 是 .cmd/.bat 批处理。不能用 shell:true（Node 会把 cmd+args 用空格
  // 直接 join、不做转义，含空格的 prompt 被拆成多个参数 → "unexpected argument"）；
  // 正确做法是 spawn cmd.exe /c，args 作为独立参数交给 Node 做默认引号转义（真实多机 benchmark 踩过）。
  const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
  const spawnOpts = {
    cwd: opts.cwd ?? process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'] as const,
  };
  const child = isWindowsBatch
    ? spawn('cmd.exe', ['/d', '/s', '/c', cmd, ...args], spawnOpts)
    : spawn(cmd, args, spawnOpts);

  let seq = 0;
  const makeSeq = (): number => ++seq;
  let ended = false;
  let cancelled = false;
  let timedOut = false;

  const emit = (ev: Omit<TaskEvent, 'taskId' | 'seq'>): void => {
    if (ended || cancelled) return;
    opts.onEvent({ ...ev, taskId: opts.taskId, seq: makeSeq() });
  };

  const timeout = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, opts.timeoutMs)
    : null;
  if (timeout) timeout.unref();

  // 启动状态
  emit({ eventType: 'status', data: { message: `${opts.cmd} 启动中` }, ts: Date.now() });

  // stdout
  const textBuf: string[] = [];
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (opts.streamJson) {
      try {
        const j = JSON.parse(line) as {
          type?: string;
          text?: string;
          result?: string;
          message?: { content?: unknown } | string;
        };
        const text = extractStreamText(j);
        if (text) {
          emit({ eventType: 'text', data: { text }, ts: Date.now() });
        } else {
          const tool = detectToolUse(j);
          if (tool) {
            emit({
              eventType: 'tool_call',
              data: { toolName: tool.name, toolInput: tool.input as Record<string, unknown> },
              ts: Date.now(),
            });
          } else if (typeof j.message === 'string' && j.message.trim()) {
            emit({ eventType: 'status', data: { message: j.message }, ts: Date.now() });
          }
        }
      } catch {
        emit({ eventType: 'text', data: { text: line }, ts: Date.now() });
      }
    } else if (opts.textOutput) {
      textBuf.push(line);
    } else {
      emit({ eventType: 'text', data: { text: line }, ts: Date.now() });
    }
  });

  // stderr → status
  const errRl = readline.createInterface({ input: child.stderr });
  errRl.on('line', (line) => {
    if (!line.trim()) return;
    emit({ eventType: 'status', data: { message: `stderr: ${line}` }, ts: Date.now() });
  });

  /** 终态（幂等）：故障归因 */
  function terminal(status: 'completed' | 'failed', message: string): void {
    if (ended) return;
    if (timeout) clearTimeout(timeout);
    // 先发终态事件，再标记 ended（阻止后续事件）
    opts.onEvent({ taskId: opts.taskId, seq: makeSeq(), eventType: 'status', status, data: { message }, ts: Date.now() });
    ended = true;
  }

  child.on('error', (err) => {
    terminal('failed', `启动失败：${err.message}（命令不存在或无执行权限）`);
  });

  child.on('close', (code) => {
    if (cancelled) return;
    if (timedOut) {
      terminal('failed', '执行超时');
      return;
    }
    if (code === 0) {
      if (opts.textOutput && textBuf.length) {
        emit({ eventType: 'text', data: { text: textBuf.join('\n') }, ts: Date.now() });
      }
      terminal('completed', `${opts.cmd} 执行完成`);
    } else {
      terminal('failed', `${opts.cmd} 退出码 ${code}`);
    }
  });

  return {
    cancel(): void {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      try {
        child.kill('SIGTERM');
      } catch {
        /* 已退出 */
      }
    },
  };
}
