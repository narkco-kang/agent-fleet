import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';

/**
 * DSH Desktop Adapter（真接）：逆向确认的 headless 调用方式。
 *
 * DSH Desktop 是 Electron 封装 @deepseek-ai/dsh（DeepSeek 超智能体原型），
 * 其 CLI 藏在 app.asar 里，通过 Electron 的 Node 模式跑：
 *   ELECTRON_RUN_AS_NODE=1 "<DSH Desktop.app>/Contents/MacOS/DSH Desktop" \
 *     harness-node-entry.mjs "app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js" headless "<prompt>"
 *
 * 实测 `dsh headless "<prompt>"` 为单轮任务（打印结果并退出）。
 * 需用户登录（credentials）+ profile 配 agent-loop 插件，未登录时报缺 credentials。
 */

const APP_NAME = 'DSH Desktop.app';
const BIN_JS = path.join('app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const HARNESS_ENTRY = 'harness-node-entry.mjs';

/** 定位 DSH Desktop.app（/Applications + ~/Applications） */
export function findDshApp(): string | null {
  const candidates = [
    path.join('/Applications', APP_NAME),
    path.join(os.homedir(), 'Applications', APP_NAME),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 读 .app 版本（Info.plist） */
function readDshVersion(app: string): string {
  try {
    const plist = path.join(app, 'Contents', 'Info.plist');
    const out = execFileSync('defaults', ['read', plist, 'CFBundleShortVersionString'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || 'unknown';
  } catch {
    return 'unknown';
  }
}

export class DshAdapter implements Adapter {
  readonly agentType = 'dsh' as const;
  readonly displayName = 'DSH Desktop';
  private handles = new Map<string, AdapterRunHandle>();

  async detect(): Promise<AdapterDetection> {
    const app = findDshApp();
    if (!app) {
      return {
        found: false,
        agentType: 'dsh',
        executable: '',
        version: '',
        detectMethod: 'app',
        capabilities: ['shell', 'coding'],
        maxConcurrency: 1,
      };
    }
    return {
      found: true,
      agentType: 'dsh',
      executable: app,
      version: readDshVersion(app),
      detectMethod: 'app',
      capabilities: ['shell', 'coding'],
      maxConcurrency: 1,
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    let seq = 0;
    const makeSeq = (): number => ++seq;

    const app = findDshApp();
    if (!app) {
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: 'status',
        status: 'failed',
        data: { message: '未检测到 DSH Desktop.app' },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    const resources = path.join(app, 'Contents', 'Resources');
    const electron = path.join(app, 'Contents', 'MacOS', 'DSH Desktop');
    const harness = path.join(resources, HARNESS_ENTRY);
    const binJs = path.join(resources, BIN_JS);

    // Electron Node 模式 + harness-node-entry + bin.js + headless + prompt
    const child = spawn(electron, [harness, binJs, 'headless', task.prompt], {
      cwd: resources,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let finished = false;
    const emit = (eventType: string, status: 'completed' | 'failed' | undefined, message: string, text?: string): void => {
      if (finished) return;
      sink({
        taskId: task.taskId,
        seq: makeSeq(),
        eventType: eventType as never,
        status,
        data: text !== undefined ? { text } : { message },
        ts: Date.now(),
      });
    };

    // 过滤 harness 噪音：harness-node 前缀 / Chromium 日志 / peerDependencies 兼容警告
    const isNoise = (line: string): boolean =>
      /^\[harness-node\]/.test(line) ||
      /^\[[0-9]{4}\//.test(line) ||
      /compatibility warning|peerDependencies/.test(line);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const clean = line.trim();
      if (!clean || isNoise(clean)) return;
      emit('text', undefined, '', clean);
    });

    const errRl = readline.createInterface({ input: child.stderr });
    errRl.on('line', (line) => {
      const clean = line.trim();
      if (!clean || isNoise(clean)) return;
      emit('status', undefined, clean);
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      emit('status', 'failed', `DSH 启动失败: ${err.message}`);
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      if (code === 0) {
        emit('status', 'completed', 'DSH headless 执行完成');
      } else {
        emit('status', 'failed', `DSH 退出码 ${code}（可能未登录或 profile 缺 agent-loop 插件，请在本机 DSH Desktop 登录后重试）`);
      }
    });

    const handle: AdapterRunHandle = {
      cancel: () => {
        finished = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* 已退出 */
        }
      },
    };
    this.handles.set(task.taskId, handle);
    return handle;
  }

  cancel(taskId: string): void {
    this.handles.get(taskId)?.cancel();
    this.handles.delete(taskId);
  }
}
