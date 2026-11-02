import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { TaskEvent, TaskEventData, TaskEventType } from '@agentfleet/shared';

/**
 * 子进程运行器：spawn + readline 按行解析 stdout，映射为 task.event。
 *
 * 约定：平台 CLI 输出 JSONL（每行一个事件）；无法识别的行按 text 事件透传，
 * 保证不静默丢失。支持把 prompt 写入 stdin（stdio 模式）。
 */

export interface SpawnOptions {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** 将 prompt 写入子进程 stdin 后关闭（stdio 模式） */
  stdin?: string;
  onLine?: (line: string) => void;
}

export interface ProcessRunnerHandle {
  child: ChildProcess;
  cancel(): void;
  /** 结束 Promise（进程退出时 resolve） */
  done: Promise<{ code: number | null }>;
}

export interface JsonlEvent {
  type?: string;
  subtype?: string;
  status?: TaskEvent['status'];
  text?: string;
  delta?: string | { type?: string; text?: string; thinking?: string };
  message?: string;
  errors?: unknown[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

/**
 * 启动子进程，把 stdout 流式解析为 task.event 回调。
 */
export function runProcess(
  taskId: string,
  opts: SpawnOptions,
  sink: (event: TaskEvent) => void,
  makeSeq: () => number,
): ProcessRunnerHandle {
  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    opts.onLine?.(line);
    const event = parseLine(taskId, line, makeSeq);
    if (event) sink(event);
  });

  // stderr 也按 system 事件透传（避免错误静默丢失）
  const errRl = readline.createInterface({ input: child.stderr });
  errRl.on('line', (line) => {
    if (!line.trim()) return;
    sink({
      taskId,
      seq: makeSeq(),
      eventType: 'system',
      data: { message: `stderr: ${line}` },
      ts: Date.now(),
    });
  });

  // 可选写入 stdin
  if (opts.stdin != null && child.stdin) {
    child.stdin.write(opts.stdin);
    child.stdin.end();
  }

  child.on('error', (err) => {
    sink({
      taskId,
      seq: makeSeq(),
      eventType: 'status',
      status: 'failed',
      data: { message: `子进程启动失败: ${err.message}` },
      ts: Date.now(),
    });
  });

  const done = new Promise<{ code: number | null }>((resolve) => {
    child.on('close', (code) => resolve({ code }));
  });

  let cancelled = false;
  return {
    child,
    done,
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 3_000).unref();
      } catch {
        /* 已退出 */
      }
    },
  };
}

/** 解析单行输出 → TaskEvent（无法解析则按 text 处理） */
function parseLine(taskId: string, line: string, makeSeq: () => number): TaskEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // 尝试 JSONL
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as JsonlEvent & {
        delta?: { type?: string; text?: string; thinking?: string };
      };

      // Anthropic Messages 流式格式（grok --output-format streaming-messages-json）
      if (obj.type === 'content_block_delta') {
        const deltaType = obj.delta?.type;
        if (deltaType === 'text_delta' && obj.delta?.text) {
          return { taskId, seq: makeSeq(), eventType: 'text', data: { text: obj.delta.text }, ts: Date.now() };
        }
        if (deltaType === 'thinking_delta' && obj.delta?.thinking) {
          return { taskId, seq: makeSeq(), eventType: 'thinking', data: { text: obj.delta.thinking }, ts: Date.now() };
        }
        // 工具调用片段：忽略（或后续聚合）
        return null;
      }
      if (obj.type === 'message_start' || obj.type === 'message_delta' || obj.type === 'message_stop') {
        return null;
      }

      // grok 原生结果/系统事件（streaming-json 格式）→ 规范化为标准 task.event
      if (obj.type === 'result') {
        if (obj.subtype === 'error_during_execution' || obj.status === 'failed') {
          const msg = (obj.errors ?? []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ');
          return {
            taskId,
            seq: makeSeq(),
            eventType: 'status',
            status: 'failed',
            data: { message: msg || obj.message || 'grok 执行出错' },
            ts: Date.now(),
          };
        }
        return null; // 成功 result 由进程退出码/上层结果事件处理
      }
      if (obj.type === 'system') {
        const msg = obj.subtype ? `[${obj.subtype}] ${obj.message ?? ''}`.trim() : (obj.message ?? '');
        if (!msg) return null;
        return {
          taskId,
          seq: makeSeq(),
          eventType: 'system',
          data: { message: msg },
          ts: Date.now(),
        };
      }

      const data: TaskEventData = {
        text: obj.text ?? obj.delta?.text ?? (typeof obj.delta === 'string' ? obj.delta : undefined),
        message: obj.message,
        toolName: obj.toolName,
        toolInput: obj.toolInput,
        toolOutput: obj.toolOutput,
      };
      return {
        taskId,
        seq: makeSeq(),
        eventType: (obj.type ?? 'text') as TaskEventType,
        status: obj.status,
        data,
        ts: Date.now(),
      };
    } catch {
      /* fallthrough：非 JSON 行按文本处理 */
    }
  }

  // 纯文本行
  return {
    taskId,
    seq: makeSeq(),
    eventType: 'text',
    data: { text: line },
    ts: Date.now(),
  };
}
