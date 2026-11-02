import type { AgentInfo, AgentType, TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterEventSink } from './adapter.js';
import { GrokAdapter } from './grokAdapter.js';
import { DshAdapter } from './dshAdapter.js';
import { CatalogAdapter } from './catalogAdapter.js';
import { PLATFORM_CATALOG } from './platformCatalog.js';
import { BenchAdapter } from './benchAdapter.js';

/**
 * Adapter 注册表：统一探测 + 按类型查找 + 任务派发。
 * - GrokAdapter 真接（ACP）+ DshAdapter 真接（Electron Node 模式 headless）
 * - 其余平台由 CatalogAdapter 从目录表自动生成（探测 + runSpec 真接/占位）
 * - AGENTFLEET_BENCH=1 时全部替换为 BenchAdapter（mock 执行，供调度 benchmark）
 */
const BENCH_MODE = process.env.AGENTFLEET_BENCH === '1';
const BENCH_AGENT_TYPES = (process.env.BENCH_AGENTS ?? 'codex,claude,gemini')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean) as AgentType[];

export const adapters: Adapter[] = BENCH_MODE
  ? BENCH_AGENT_TYPES.map((t) => new BenchAdapter(t))
  : [
      new GrokAdapter(),
      new DshAdapter(),
      ...PLATFORM_CATALOG.filter((def) => def.agentType !== 'dsh').map((def) => new CatalogAdapter(def)),
    ];

/** 按 agentType 查找 Adapter */
export function findAdapter(agentType: AgentType): Adapter | undefined {
  return adapters.find((a) => a.agentType === agentType);
}

/** 探测全部平台，返回已安装的 AgentInfo 列表 */
export async function detectAllAgents(): Promise<AgentInfo[]> {
  const results: AgentInfo[] = [];
  for (const adapter of adapters) {
    const d = await adapter.detect();
    if (d.found) {
      results.push({
        agentType: d.agentType,
        displayName: adapter.displayName,
        version: d.version,
        executable: d.executable,
        status: 'available',
        detectMethod: d.detectMethod,
        capabilities: d.capabilities,
        maxConcurrency: d.maxConcurrency,
        bots: d.bots,
      });
    }
  }
  return results;
}

/** 派发任务到对应 Adapter，流式事件回传 */
export async function dispatchToAdapter(
  agentType: AgentType,
  task: TaskSubmit,
  sink: AdapterEventSink,
): Promise<{ cancel(): void }> {
  const adapter = findAdapter(agentType);
  if (!adapter) {
    sink({
      taskId: task.taskId,
      seq: 1,
      eventType: 'status',
      status: 'failed',
      data: { message: `未找到 ${agentType} Adapter` },
      ts: Date.now(),
    });
    return { cancel: () => undefined };
  }
  return adapter.run(task, sink);
}

/** 取消任务（转交给对应 adapter） */
export function cancelTaskOnAdapter(agentType: AgentType, taskId: string): void {
  findAdapter(agentType)?.cancel(taskId);
}
