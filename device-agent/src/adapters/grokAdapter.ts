import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaskSubmit } from '@agentmesh/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { runProcess } from '../runner/processRunner.js';

/**
 * Grok Adapter（真接）：
 *  - detect：约定目录（~/.grok/bin/grok、~/.local/bin/grok）+ which + 版本。
 *  - run：`grok agent headless`（stdio 亦可），spawn + readline 流式解析。
 */
export class GrokAdapter implements Adapter {
  readonly agentType = 'grok' as const;
  readonly displayName = 'Grok';
  private handles = new Map<string, AdapterRunHandle>();

  async detect(): Promise<AdapterDetection> {
    const exe = findGrok();
    if (!exe) {
      return {
        found: false,
        agentType: 'grok',
        executable: '',
        version: '',
        detectMethod: 'default_dir',
        capabilities: ['coding', 'shell', 'reasoning'],
        maxConcurrency: 1,
      };
    }
    const version = this.readVersion(exe);
    return {
      found: true,
      agentType: 'grok',
      executable: exe,
      version,
      detectMethod: exe.includes('.grok') ? 'default_dir' : 'path',
      capabilities: ['coding', 'shell', 'reasoning', 'subagents'],
      maxConcurrency: 1,
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    const detection = await this.detect();
    let seq = 0;
    const makeSeq = (): number => ++seq;

    if (!detection.found) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: { message: '未检测到 grok 可执行文件' },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    // 真接：`grok -p/--single <prompt> --output-format streaming-messages-json`，
    // 单轮输出到 stdout 后退出，readline 逐行解析流式事件。
    const handle = runProcess(
      task.taskId,
      {
        cmd: detection.executable,
        args: [
          '--single',
          task.prompt,
          '--output-format',
          'streaming-messages-json',
          '--always-approve',
        ],
        stdin: undefined,
        env: {},
        onLine: (_line) => {
          /* 已由 runProcess 统一解析 */
        },
      },
      sink,
      makeSeq,
    );

    // 进程退出 → 发出结果事件（由上层决定最终 status）
    handle.done.then(({ code }) => {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: code === 0 ? 'completed' : 'failed',
        data: { message: code === 0 ? 'grok 执行完成' : `grok 退出码 ${code}` },
        ts: Date.now(),
      });
    });

    const runHandle: AdapterRunHandle = {
      cancel: () => handle.cancel(),
    };
    this.handles.set(task.taskId, runHandle);
    return runHandle;
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
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      // grok --version 输出形如 "grok 1.0.62 (1474f9cbdd91)"，仅取版本号
      const m = out.match(/\d+\.\d+\.\d+/);
      return m ? m[0] : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

/** 定位 grok 可执行文件 */
export function findGrok(): string | null {
  const candidates = [
    path.join(os.homedir(), '.grok', 'bin', 'grok'),
    path.join(os.homedir(), '.local', 'bin', 'grok'),
    '/usr/local/bin/grok',
    '/opt/homebrew/bin/grok',
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  // PATH 兜底
  try {
    const p = execFileSync('which', ['grok'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return p || null;
  } catch {
    return null;
  }
}
