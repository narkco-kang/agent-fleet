import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Benchmark 结果沉淀报告：读取 benchmark-results/runs.jsonl，渲染成 markdown 汇总表。
 *
 * 用法：
 *   npm run benchmark:report --workspace backend
 *   npm run benchmark:report --workspace backend -- --write docs/24-benchmark报告.md
 */

interface BenchRun {
  kind: 'scheduler' | 'multidevice';
  ts: string;
  config: {
    devices: number;
    agentsPerDevice: number;
    totalAgents: number;
    tasks: number;
    execMs: number;
    concurrency?: number;
    failInjected: boolean;
  };
  throughput_tasks_per_sec: number;
  wall_ms: number;
  completed: number;
  lost_tasks: number;
  sched_latency_ms?: { p50: number; p90: number; p95: number; p99: number };
  e2e_latency_ms: { p50: number; p90: number; p95: number; p99: number; max: number };
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'benchmark-results');
const file = path.join(dir, 'runs.jsonl');

function load(): BenchRun[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BenchRun);
}

function fmt(n: number | undefined, unit = ''): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('en-US')}${unit}`;
}

function pct(r: BenchRun): string {
  if (r.sched_latency_ms) return fmt(r.sched_latency_ms.p50, 'ms');
  return fmt(r.e2e_latency_ms.p50, 'ms');
}

function render(runs: BenchRun[]): string {
  const lines: string[] = [];
  lines.push(`# Benchmark 运行历史（自动生成，勿手改）`);
  lines.push('');
  lines.push(`> 来源：\`backend/benchmark-results/runs.jsonl\`（各 benchmark 脚本加 \`--save\` 自动追加）。`);
  lines.push(`> 共 ${runs.length} 次运行，生成时间 ${new Date().toISOString()}。`);
  lines.push('');
  lines.push(`## 调度内核（scheduler）`);
  lines.push('');
  lines.push(`| 时间 | 设备×agent | 任务 | 单任务 | 吞吐 | completed | lost | 调度 P50/P90/P99 | 故障注入 |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of runs.filter((x) => x.kind === 'scheduler')) {
    const s = r.sched_latency_ms;
    lines.push(
      `| ${r.ts.slice(0, 19)} | ${r.config.devices}×${r.config.agentsPerDevice} | ${r.config.tasks} | ${r.config.execMs}ms | ${fmt(r.throughput_tasks_per_sec, ' tasks/s')} | ${r.completed} | ${r.lost_tasks} | ${fmt(s?.p50, 'ms')}/${fmt(s?.p90, 'ms')}/${fmt(s?.p99, 'ms')} | ${r.config.failInjected ? '✅' : '—'} |`,
    );
  }
  lines.push('');
  lines.push(`## 真实多设备（multidevice，独立进程 ws 链路）`);
  lines.push('');
  lines.push(`| 时间 | 设备×agent | 任务 | 单任务 | 吞吐 | completed | lost | e2e P50/P90/P99 | 故障注入 |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of runs.filter((x) => x.kind === 'multidevice')) {
    const e = r.e2e_latency_ms;
    lines.push(
      `| ${r.ts.slice(0, 19)} | ${r.config.devices}×${r.config.agentsPerDevice} | ${r.config.tasks} | ${r.config.execMs}ms | ${fmt(r.throughput_tasks_per_sec, ' tasks/s')} | ${r.completed} | ${r.lost_tasks} | ${fmt(e.p50, 'ms')}/${fmt(e.p90, 'ms')}/${fmt(e.p99, 'ms')} | ${r.config.failInjected ? '✅' : '—'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const runs = load();
  if (runs.length === 0) {
    console.log('暂无 benchmark 记录。先跑 `npm run benchmark --workspace backend -- --save` 生成。');
    process.exit(0);
  }
  const md = render(runs);
  const writeIdx = process.argv.indexOf('--write');
  if (writeIdx >= 0 && process.argv[writeIdx + 1]) {
    const out = path.resolve(process.cwd(), process.argv[writeIdx + 1]);
    fs.writeFileSync(out, md + '\n');
    console.log(`已写入 ${out}`);
  } else {
    console.log(md);
  }
}

main();
