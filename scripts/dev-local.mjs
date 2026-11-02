#!/usr/bin/env node
/**
 * 本机一键联调：backend + frontend + device-agent 同时启动。
 *
 * 为什么需要这个脚本（而不是三条 npm run 拼一起）：
 *
 * 在 WorkBuddy / 某些 IDE / CI runner 里，Node 子进程会被注入输出管道 shim
 * （`NODE_OPTIONS=--require=.../node-language-shim.cjs` 等）。该 shim 会把
 * net / fs 调用转发给宿主的 broker IPC 通道；一旦宿主侧连接关闭，就会：
 *   1. 抛 EPIPE 未捕获异常，直接杀死 device-agent（守护进程本该常驻）；
 *   2. 即使进程侥幸存活，WS 心跳也会被 shim 干扰，设备在看板上长期 offline。
 *
 * 所以这里在 spawn 前剥离宿主注入的 shim 环境，让子进程是纯净 Node。
 * 生产环境（systemd / Docker / 用户自己终端）没有这些变量，剥离是空操作。
 *
 * 用法：
 *   npm run dev:local              # backend:4173 + frontend:5173 + 1 台设备
 *   npm run dev:local -- --no-agent  # 只起 backend + frontend
 *   npm run dev:local -- --agent 2   # 起 2 台设备（模拟多设备蜂群）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 宿主注入的、会干扰子进程的环境变量 */
const HOST_INJECTED_ENV = [
  'NODE_OPTIONS',
  'BASH_ENV',
  'CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS',
  'CODEBUDDY_SANDBOX_BROKER_SESSION_ID',
  'SANDBOX_CENTER_IPC_ADDRESS',
  'SANDBOX_CENTER_UID',
  'TOYBOX_SANDBOX_SOCK',
];

const COLORS = { backend: '\x1b[36m', frontend: '\x1b[35m', device: '\x1b[32m', reset: '\x1b[0m' };

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of HOST_INJECTED_ENV) delete env[key];
  return env;
}

/** 解析简单命令行参数 */
function parseArgs(argv) {
  const args = { agentCount: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-agent') args.agentCount = 0;
    else if (argv[i] === '--agent') {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 0) {
        args.agentCount = n;
        i += 1;
      }
    }
  }
  return args;
}

const children = [];

function run(label, npmArgs, extraEnv) {
  const color = COLORS[label] ?? '';
  const proc = spawn('npm', npmArgs, {
    cwd: ROOT,
    env: cleanEnv(extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `${color}[${label}]${COLORS.reset} `;
  const pipe = (stream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) process.stdout.write(prefix + line + '\n');
      }
    });
  };
  pipe(proc.stdout);
  pipe(proc.stderr);
  proc.on('exit', (code, signal) => {
    process.stdout.write(`${prefix}进程退出 code=${code ?? '-'} signal=${signal ?? '-'}\n`);
  });
  children.push(proc);
  return proc;
}

/** 轮询等待 HTTP 服务就绪 */
async function waitForHttp(url, timeoutMs = 40_000, label = '') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(`\x1b[33m[dev] 等待 ${label || url} 超时（继续启动剩余进程）\x1b[0m\n`);
  return false;
}

async function main() {
  const { agentCount } = parseArgs(process.argv.slice(2));
  const backendPort = Number(process.env.BACKEND_PORT ?? 4173);
  const coordinatorUrl = process.env.COORDINATOR_URL ?? `ws://127.0.0.1:${backendPort}`;
  const coordinatorHttpUrl = process.env.COORDINATOR_HTTP_URL ?? `http://127.0.0.1:${backendPort}`;

  process.stdout.write('\x1b[1m[dev] 启动 AgentFleet 本机联调\x1b[0m\n');
  process.stdout.write(`[dev] backend  : http://127.0.0.1:${backendPort}\n`);
  process.stdout.write('[dev] frontend : http://127.0.0.1:5173\n');
  process.stdout.write(`[dev] 设备数   : ${agentCount}\n\n`);

  run('backend', ['run', 'start', '--workspace', 'backend'], { BACKEND_PORT: String(backendPort) });
  // backend 没有 /api/health，用设备列表作为「HTTP 已就绪」的探针
  await waitForHttp(`http://127.0.0.1:${backendPort}/api/devices`, 45_000, 'backend /api/devices');

  run('frontend', ['run', 'dev', '--workspace', 'frontend']);
  await waitForHttp('http://127.0.0.1:5173', 45_000, 'frontend :5173');

  for (let i = 0; i < agentCount; i += 1) {
    // 多设备模拟：每台设备用独立 dataDir，避免复用同一 deviceId
    const dataDir = i === 0 ? undefined : path.join(ROOT, '.dev-devices', `agent-${i + 1}`);
    run('device', ['run', 'start', '--workspace', 'device-agent'], {
      COORDINATOR_URL: coordinatorUrl,
      COORDINATOR_HTTP_URL: coordinatorHttpUrl,
      ...(dataDir ? { DEVICE_DATA_DIR: dataDir } : {}),
      ...(i > 0 ? { DEVICE_NAME: `${process.env.DEVICE_NAME ?? 'dev-agent'}-${i + 1}` } : {}),
    });
    await new Promise((r) => setTimeout(r, 2500));
  }

  // 设备就绪后打印一次看板真实状态，便于确认「配对 + 能力上报」是否成功
  if (agentCount > 0) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const res = await fetch(`http://127.0.0.1:${backendPort}/api/devices`);
      const body = await res.json();
      const list = Array.isArray(body?.data) ? body.data : [];
      process.stdout.write(`\n\x1b[1m[dev] 看板设备（${list.length} 台）\x1b[0m\n`);
      for (const d of list) {
        process.stdout.write(
          `[dev]   · ${d.name} status=${d.status} agents=${(d.agents ?? []).length} roleTeam=${d.roleTeamName ?? '-'}\n`,
        );
      }
      process.stdout.write('\n');
    } catch (err) {
      process.stdout.write(`\x1b[33m[dev] 查询设备列表失败: ${err.message}\x1b[0m\n`);
    }
  }

  process.stdout.write('\x1b[1m[dev] 全部进程已启动，Ctrl+C 统一退出\x1b[0m\n\n');
}

const shutdown = () => {
  process.stdout.write('\n[dev] 正在关闭所有进程...\n');
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 800);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  process.stderr.write(`[dev] 启动失败: ${err.stack ?? err}\n`);
  shutdown();
});
