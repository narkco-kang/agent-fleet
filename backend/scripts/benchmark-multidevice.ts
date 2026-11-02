import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 真实多设备蜂群调度 benchmark（可复现）
 *
 * 起 1 个 backend 协调器 + N 个 bench 模式 device-agent（各为独立进程/独立数据目录），
 * 走真实 ws 链路（注册 → 能力上报 → 派发 → 认领 → 执行 → 结果回传），
 * 执行是可控延迟的 mock（不依赖真实 agent 登录态）。
 *
 * 度量：吞吐 / 端到端延迟 P50/P95 / 任务完成率（不丢任务）。
 *
 * 用法：
 *   npm run benchmark:multi --workspace backend
 *   npm run benchmark:multi --workspace backend -- --devices 4 --agents 2 --tasks 200 --exec-ms 20 --concurrency 1
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
// 用 node --import tsx 直接跑（不 spawn 子进程），否则 kill 杀不掉真正的 device-agent 进程
const TSX_ARGS = ['--import', 'tsx', 'src/index.ts'];

const AGENT_POOL = [
  'codex', 'claude', 'gemini', 'cursor', 'aider', 'qwen', 'kimi',
  'grok', 'cody', 'doubao', 'opencode', 'windsurf', 'dsh',
];

interface MultiArgs {
  devices: number;
  agentsPerDevice: number;
  tasks: number;
  execMs: number;
  concurrency: number;
  failDeviceAtMs: number;
}

function parseArgs(argv: string[]): MultiArgs {
  const get = (k: string, d: number): number => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
  };
  return {
    devices: get('devices', 2),
    agentsPerDevice: get('agents', 2),
    tasks: get('tasks', 100),
    execMs: get('exec-ms', 20),
    concurrency: get('concurrency', 1),
    failDeviceAtMs: get('fail-at', 0),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  return (await res.json()) as Record<string, unknown>;
}

interface SnapshotTask {
  status: string;
  createdAt?: number;
  startedAt?: number;
  finishedAt?: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const PORT = 4173;
  const base = `http://127.0.0.1:${PORT}`;
  const benchAgents = AGENT_POOL.slice(0, args.agentsPerDevice).join(',');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentmesh-multibench-'));
  const dbPath = path.join(tmp, 'bench.db');
  const procs: ChildProcess[] = [];

  console.log(
    `# 真实多设备调度 benchmark：${args.devices} 设备 × ${args.agentsPerDevice} agent，` +
      `${args.tasks} 任务，单任务 ${args.execMs}ms，每 agent 并发 ${args.concurrency}`,
  );

  const cleanup = (): void => {
    for (const p of procs) {
      try {
        p.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  process.on('exit', cleanup);

  // 1) 起 backend（临时 DB + 固定端口）
  const backend = spawn(process.execPath, TSX_ARGS, {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, BACKEND_PORT: String(PORT), DB_PATH: dbPath },
    stdio: 'ignore',
  });
  procs.push(backend);

  let backendUp = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetchJson(`${base}/api/devices`);
      if (r.ok) {
        backendUp = true;
        break;
      }
    } catch {
      /* not yet */
    }
    await sleep(200);
  }
  if (!backendUp) throw new Error('backend 未在超时内启动');

  // 2) 起 N 个 bench 模式 device-agent（独立数据目录 → 独立 deviceId）
  for (let d = 0; d < args.devices; d++) {
    const proc = spawn(process.execPath, TSX_ARGS, {
      cwd: path.join(ROOT, 'device-agent'),
      env: {
        ...process.env,
        AGENTFLEET_BENCH: '1',
        COORDINATOR_URL: `ws://127.0.0.1:${PORT}`,
        COORDINATOR_HTTP_URL: base,
        DEVICE_DATA_DIR: path.join(tmp, `dev-${d}`),
        DEVICE_NAME: `bench-dev-${d}`,
        BENCH_AGENTS: benchAgents,
        BENCH_EXEC_MS: String(args.execMs),
        BENCH_MAX_CONCURRENCY: String(args.concurrency),
      },
      stdio: 'ignore',
    });
    procs.push(proc);
  }

  // 3) 等设备注册 + agent 能力就绪
  let ready = false;
  for (let i = 0; i < 200; i++) {
    const r = await fetchJson(`${base}/api/devices`);
    const devices = (r.data as Array<{ agents?: unknown[] }>) ?? [];
    const readyCount = devices.filter(
      (d) => Array.isArray(d.agents) && d.agents.length >= args.agentsPerDevice,
    ).length;
    if (readyCount >= args.devices) {
      ready = true;
      break;
    }
    await sleep(200);
  }
  if (!ready) throw new Error('设备未在超时内就绪（agent 能力未上报）');

  // 4) 提交任务
  const t0 = Date.now();
  for (let j = 0; j < args.tasks; j++) {
    await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `bench task ${j}`, target: { mode: 'auto' } }),
    });
  }

  // 5) 故障注入：kill 第一个 device-agent（procs[1]）
  let failInjected = false;
  if (args.failDeviceAtMs > 0 && procs.length > 1) {
    setTimeout(() => {
      try {
        procs[1].kill('SIGKILL');
        failInjected = true;
        console.log(`# [故障注入] device-agent[0] 于 ${args.failDeviceAtMs}ms 被 kill`);
      } catch {
        /* ignore */
      }
    }, args.failDeviceAtMs);
    // 诊断：kill 后每 1s 查一次设备，看 lastHeartbeat 是否停止更新（共 8 次）
    setTimeout(async () => {
      for (let k = 0; k < 8; k++) {
        try {
          const rr = await fetchJson(`${base}/api/devices`);
          const devices = (rr.data as Array<{ deviceId?: string; status?: string; lastHeartbeat?: number }>) ?? [];
          const now = Date.now();
          const detail = devices
            .map((d) => `${d.deviceId?.slice(-6)}:${d.status}:${d.lastHeartbeat ? Math.round((now - d.lastHeartbeat) / 1000) : '?'}s`)
            .join(' | ');
          console.log(`# [诊断] kill后${k + 1}s ${detail}`);
        } catch {
          /* ignore */
        }
        await sleep(1000);
      }
    }, args.failDeviceAtMs + 1000);
  }

  // 6) 轮询直到全部终态
  const terminal = (s: string): boolean =>
    s === 'completed' || s === 'failed' || s === 'interrupted' || s === 'cancelled';
  let done = 0;
  for (let i = 0; i < 2000; i++) {
    const r = await fetchJson(`${base}/api/tasks`);
    const tasks = (r.data as SnapshotTask[]) ?? [];
    done = tasks.filter((t) => terminal(t.status)).length;
    if (done >= args.tasks) break;
    await sleep(100);
  }
  const tEnd = Date.now();

  // 7) 统计
  const r = await fetchJson(`${base}/api/tasks`);
  const tasks = (r.data as SnapshotTask[]) ?? [];
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const interrupted = tasks.filter((t) => t.status === 'interrupted').length;
  const e2e = tasks
    .filter((t) => t.finishedAt && t.createdAt)
    .map((t) => (t.finishedAt as number) - (t.createdAt as number))
    .sort((a, b) => a - b);

  const result = {
    config: {
      devices: args.devices,
      agentsPerDevice: args.agentsPerDevice,
      totalAgents: args.devices * args.agentsPerDevice,
      tasks: args.tasks,
      execMs: args.execMs,
      concurrency: args.concurrency,
      failInjected: failInjected,
    },
    throughput_tasks_per_sec: Number((args.tasks / ((tEnd - t0) / 1000)).toFixed(2)),
    wall_ms: tEnd - t0,
    completed,
    failed,
    interrupted,
    lost_tasks: args.tasks - completed - failed - interrupted,
    e2e_latency_ms: {
      p50: e2e[Math.floor(e2e.length * 0.5)] ?? 0,
      p95: e2e[Math.floor(e2e.length * 0.95)] ?? 0,
      max: e2e[e2e.length - 1] ?? 0,
    },
  };

  console.log('\n' + JSON.stringify(result, null, 2));
  cleanup();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
