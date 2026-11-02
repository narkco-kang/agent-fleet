import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { initDatabase, closeDatabase } from '../src/db/database.js';
import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { upsertAgents } from '../src/db/repo/agents.js';
import { upsertDevice } from '../src/db/repo/devices.js';
import { setTaskResult } from '../src/db/repo/tasks.js';
import { enqueueTask, setSchedulerHooks, release } from '../src/services/scheduler.js';
import type { AgentType } from '@agentfleet/shared';

/**
 * AgentFleet 调度内核 benchmark（可复现）
 *
 * 度量跨设备蜂群调度的核心指标：
 *   1. 吞吐：N 设备 × K agent 下，M 任务的完成吞吐（tasks/s）
 *   2. 调度延迟：enqueue → running 的 P50/P95
 *   3. 端到端延迟：enqueue → completed 的 P50/P95
 *   4. 认领限流：峰值并发 ≤ 总 agent 数（每 agent max_concurrency=1）
 *   5. 故障转移：--fail-at 后让 dev-0 掉线，验证剩余任务仍全部完成（不丢任务）
 *
 * 用法：
 *   npm run benchmark --workspace backend
 *   npm run benchmark --workspace backend -- --devices 8 --agents 3 --tasks 1000 --exec-ms 10
 *   npm run benchmark --workspace backend -- --fail-at 100
 */

const AGENT_POOL: AgentType[] = ['codex', 'claude', 'gemini', 'cursor', 'aider', 'qwen', 'kimi'];

interface BenchArgs {
  devices: number;
  agentsPerDevice: number;
  tasks: number;
  execMs: number;
  failDeviceAtMs: number;
}

function parseArgs(argv: string[]): BenchArgs {
  const get = (k: string, d: number): number => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
  };
  return {
    devices: get('devices', 4),
    agentsPerDevice: get('agents', 2),
    tasks: get('tasks', 200),
    execMs: get('exec-ms', 20),
    failDeviceAtMs: get('fail-at', 0),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const totalAgents = args.devices * args.agentsPerDevice;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-bench-'));
  config.dbPath = path.join(tmp, 'bench.db');
  initDatabase();

  console.log('# AgentFleet 调度内核 benchmark');
  console.log(
    `# 设备=${args.devices} agent/设备=${args.agentsPerDevice} 总agent=${totalAgents} 任务=${args.tasks} 单任务=${args.execMs}ms` +
      (args.failDeviceAtMs > 0 ? ` 故障注入@${args.failDeviceAtMs}ms` : ''),
  );

  for (let d = 0; d < args.devices; d++) {
    const devId = `dev-${d}`;
    deviceRegistry.register(devId, `Dev ${d}`, 'relay');
    upsertDevice({
      deviceId: devId,
      name: `Dev ${d}`,
      hostname: `dev-${d}`,
      os: { platform: 'linux', arch: 'x64', release: '6.0' },
      version: '0.1.0',
    });
    const agents = [];
    for (let a = 0; a < args.agentsPerDevice; a++) {
      const t = AGENT_POOL[a % AGENT_POOL.length];
      agents.push({
        agentType: t,
        displayName: t,
        version: '1.0.0',
        executable: t,
        status: 'available' as const,
        detectMethod: 'which' as const,
        capabilities: [],
        maxConcurrency: 1,
      });
    }
    upsertAgents(devId, agents);
  }

  const times = new Map<string, { enqueue: number; running: number; done: number }>();
  let completed = 0;
  let runningNow = 0;
  let peakRunning = 0;
  let offline = false;

  let resolveAll!: () => void;
  const allDone = new Promise<void>((r) => (resolveAll = r));

  setSchedulerHooks({
    onDispatched: (taskId, deviceId, agentType) => {
      const t = times.get(taskId);
      if (t) t.running = Date.now();
      runningNow++;
      peakRunning = Math.max(peakRunning, runningNow);
      setTimeout(() => {
        setTaskResult(taskId, {
          status: 'completed',
          resultText: 'ok',
          exitCode: 0,
          durationMs: args.execMs,
        });
        release(deviceId, agentType);
        if (t) t.done = Date.now();
        runningNow--;
        completed++;
        if (completed === args.tasks) resolveAll();
      }, args.execMs);
    },
    onEvent: () => {},
  });

  const t0 = Date.now();
  for (let j = 0; j < args.tasks; j++) {
    const taskId = `task-${j}`;
    times.set(taskId, { enqueue: Date.now(), running: 0, done: 0 });
    enqueueTask({
      taskId,
      sessionId: 'bench',
      origin: 'dashboard',
      originRef: 'bench',
      prompt: 'ping',
      targetMode: 'auto',
    });
  }

  if (args.failDeviceAtMs > 0) {
    setTimeout(() => {
      deviceRegistry.remove('dev-0');
      offline = true;
      console.log(`# [故障注入] dev-0 于 ${args.failDeviceAtMs}ms 掉线`);
    }, args.failDeviceAtMs);
  }

  await allDone;
  const tEnd = Date.now();

  const e2e = [...times.values()]
    .map((t) => t.done - t.enqueue)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const sched = [...times.values()]
    .map((t) => t.running - t.enqueue)
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);
  const wallMs = tEnd - t0;

  const result = {
    config: {
      devices: args.devices,
      agentsPerDevice: args.agentsPerDevice,
      totalAgents,
      tasks: args.tasks,
      execMs: args.execMs,
      failInjected: args.failDeviceAtMs > 0,
    },
    throughput_tasks_per_sec: Number((args.tasks / (wallMs / 1000)).toFixed(2)),
    wall_ms: wallMs,
    peak_running: peakRunning,
    theoretical_peak_running: totalAgents,
    limit_ok: peakRunning <= totalAgents,
    sched_latency_ms: {
      p50: percentile(sched, 0.5),
      p95: percentile(sched, 0.95),
      max: sched[sched.length - 1] ?? 0,
    },
    e2e_latency_ms: {
      p50: percentile(e2e, 0.5),
      p95: percentile(e2e, 0.95),
      max: e2e[e2e.length - 1] ?? 0,
    },
    completed,
    lost_tasks: args.tasks - completed,
    offline_injected: offline,
  };

  console.log('\n' + JSON.stringify(result, null, 2));

  closeDatabase();
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
