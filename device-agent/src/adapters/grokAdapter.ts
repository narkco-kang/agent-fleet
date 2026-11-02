import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AgentBot, TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { runAcpPrompt } from '../runner/acpClient.js';

/**
 * Grok Adapter（真接，走 ACP 协议调用「grok bot」）：
 *  - detect：约定目录（~/.grok/bin/grok、~/.local/bin/grok）+ which + 版本 + 自定义 agent（bot）列表。
 *  - run：`grok agent stdio`（ACP），完整 agent 循环（思考/工具/文本/计划），
 *    支持通过 target.agentProfile 指定 grok 的自定义 agent（bot）。
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
      bots: detectGrokBots(),
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
      agentProfile: task.target.agentProfile,
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

/** 解析 agent 定义文件（.md）frontmatter 的 name / description */
function parseAgentFrontmatter(content: string): { name?: string; description?: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = m[1];
  const name = fm.match(/^name:\s*["']?([^"'\n]+)/m)?.[1]?.trim();
  let description = fm.match(/^description:\s*["']?([^"'\n]+)/m)?.[1]?.trim();
  // YAML 多行标记（> 或 |）后内容在下一行
  if (description === '>' || description === '|') {
    description = fm.match(/^description:\s*[>|]\s*\n\s*(.+)/m)?.[1]?.trim();
  }
  return { name, description };
}

/**
 * 探测 grok 的自定义 agent（bot）列表：读 .grok/agents/*.md 与 bundled/agents/*.md，
 * 提取 frontmatter 的 name + description。优先级：项目级 > 用户级 > bundled。
 */
export function detectGrokBots(): AgentBot[] {
  const dirs = [
    path.join(os.homedir(), '.grok', 'bundled', 'agents'), // 低优先级
    path.join(os.homedir(), '.grok', 'agents'), // 用户级
    path.join(process.cwd(), '.grok', 'agents'), // 项目级（最高）
  ];
  const bots = new Map<string, AgentBot>();
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const { name, description } = parseAgentFrontmatter(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (name) bots.set(name, { name, description: description ?? '' });
      } catch {
        /* ignore */
      }
    }
  }
  return Array.from(bots.values());
}
