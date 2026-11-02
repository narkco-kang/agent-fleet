import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { runAcpPrompt } from '../runner/acpClient.js';

/**
 * Grok Adapter（真接，走 ACP 协议调用「grok bot」）：
 *  - detect：约定目录（~/.grok/bin/grok、~/.local/bin/grok）+ which + 版本。
 *  - run：`grok agent stdio`（ACP），完整 agent 循环（思考/工具/文本/计划），
 *    而非 `grok --single`（单轮模型问答）。
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

    // 走 ACP 协议调用「grok bot」（grok agent stdio），而非单轮模型问答
    const handle = runAcpPrompt({
      cmd: detection.executable,
      cwd: process.cwd(),
      prompt: task.prompt,
      onEvent: (ev) => {
        const ts = Date.now();
        switch (ev.type) {
          case 'text':
            sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'text', data: { text: ev.text }, ts });
            break;
          case 'thinking':
            sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'thinking', data: { text: ev.text }, ts });
            break;
          case 'tool':
            sink({
              taskId: task.taskId,
              seq: makeSeq(),
              eventType: 'tool_call',
              data: { toolName: ev.toolName, toolInput: ev.toolInput as Record<string, unknown> },
              ts,
            });
            break;
          case 'status':
            sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'status', data: { message: ev.message }, ts });
            break;
          case 'done':
            sink({
              taskId: task.taskId,
              seq: makeSeq(),
              eventType: 'status',
              status: 'completed',
              data: { message: 'grok bot 执行完成' },
              ts,
            });
            break;
          case 'error':
            sink({
              taskId: task.taskId,
              seq: makeSeq(),
              eventType: 'status',
              status: 'failed',
              data: { message: ev.message },
              ts,
            });
            break;
        }
      },
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
