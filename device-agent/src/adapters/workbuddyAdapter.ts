import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { runAcpPrompt } from '../runner/acpClient.js';

/**
 * WorkBuddy Adapter（真接，走 ACP 协议）——与 GrokAdapter 同构。
 *
 * WorkBuddy 桌面版基于腾讯 CodeBuddy，其 CLI 二进制名为 `codebuddy`，藏在
 * Electron app 内（不在标准 PATH）：
 *   /Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy
 *
 * 进入 ACP stdio 的正确姿势（实测）：
 *   codebuddy --serve --acp --port <p> --auth none
 * 关键点：
 *  - 只加 `--acp` 会同时起 HTTP server，默认复用固定端口 50068，
 *    与常驻的 WorkBuddy 桌面应用冲突 → `EADDRINUSE` 直接退出；必须显式给随机 --port。
 *  - `--serve --acp` 组合才会在 stdio 上跑 ACP；单独 `--acp` 会立即 exit 0。
 *  - `--auth none` 只关掉 HTTP server 的密码，不影响 ACP stdio。
 *  - 启动后要先做约 6-9s 的配置同步（SetupGalileo/pull config）才响应 initialize。
 *  - 复用本地 CLI 登录态，不需要（且不能）走 ACP authenticate —— 该调用返回 Internal error。
 *  - 设置 HTTP(S)_PROXY 环境变量会让其内部 setProxy 抛
 *    `Right-hand side of 'instanceof' is not callable` 而无法启动，故默认剥离。
 */

/** WorkBuddy.app 内 codebuddy CLI 的绝对路径 */
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

/**
 * 会触发 codebuddy `setProxy` 崩溃的代理环境变量。
 * 这些是标准代理变量，codebuddy 内部 axios proxy agent 缺实现时会抛
 * `Right-hand side of 'instanceof' is not callable`，导致进程起不来。
 * 设 AGENTFLEET_WORKBUDDY_KEEP_PROXY=1 可保留（已知会让启动失败，仅调试用）。
 */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
];

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

/** 随机高位端口：避开 50068 等桌面应用占用的固定端口 */
function randomHighPort(): number {
  return 40000 + Math.floor(Math.random() * 15000);
}

export class WorkbuddyAdapter implements Adapter {
  readonly agentType = 'workbuddy' as const;
  readonly displayName = 'WorkBuddy (CodeBuddy)';
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
    return {
      found: true,
      agentType: 'workbuddy',
      executable: exe,
      version: this.readVersion(exe),
      detectMethod: 'app',
      capabilities: ['coding', 'reasoning', 'tools'],
      maxConcurrency: 1,
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    let seq = 0;
    const makeSeq = (): number => ++seq;

    const exe = findCodebuddy();
    if (!exe) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: { message: '未检测到 WorkBuddy (CodeBuddy) 可执行文件' },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    const port = randomHighPort();
    // 代理变量会让 codebuddy 的 setProxy 抛错而起不来，默认从子进程环境移除
    const unsetEnv =
      process.env.AGENTFLEET_WORKBUDDY_KEEP_PROXY === '1' ? [] : PROXY_ENV_KEYS;

    const handle = runAcpPrompt({
      cmd: exe,
      cwd: process.cwd(),
      prompt: task.prompt,
      // --serve --acp 才会在 stdio 上跑 ACP；--port 规避 50068 被桌面应用占用
      spawnArgs: ['--serve', '--acp', '--port', String(port), '--auth', 'none'],
      agentLabel: 'workbuddy',
      // 复用本地登录态；ACP authenticate 会返回 Internal error
      skipAuthenticate: true,
      // 启动后需约 6-9s 完成配置同步才会响应 initialize
      initializeDelayMs: 9_000,
      promptTimeoutMs: 180_000,
      unsetEnv,
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
              data: { message: 'workbuddy agent 执行完成' },
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

    const runHandle: AdapterRunHandle = { cancel: () => handle.cancel() };
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
