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

export function runCli(opts: CliRunOptions): CliRunHandle {
  // 沙箱包裹（P0-2）：readonly/isolated 时用 sandbox-exec/bwrap 包裹命令
  const { cmd, args } = buildSandboxCommand(opts.sandbox ?? 'none', opts.cmd, opts.args);
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
        const j = JSON.parse(line) as { type?: string; text?: string; message?: string; content?: unknown };
        if (j.text) {
          emit({ eventType: 'text', data: { text: j.text }, ts: Date.now() });
        } else if (j.type === 'result' || j.type === 'tool_use') {
          emit({ eventType: 'tool_call', data: { toolName: j.type, toolInput: j as unknown as Record<string, unknown> }, ts: Date.now() });
        } else if (j.message) {
          emit({ eventType: 'status', data: { message: j.message }, ts: Date.now() });
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
