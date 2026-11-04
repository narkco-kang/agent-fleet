import type { AgentInfo, AgentType, TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterEventSink } from './adapter.js';
import { GrokAdapter } from './grokAdapter.js';
import { DshAdapter } from './dshAdapter.js';
import { WorkbuddyAdapter } from './workbuddyAdapter.js';
import { CatalogAdapter } from './catalogAdapter.js';
import { PLATFORM_CATALOG } from './platformCatalog.js';
import { BenchAdapter } from './benchAdapter.js';

/**
 * Adapter 注册表：统一探测 + 按类型查找 + 任务派发。
 * - 专用 Adapter 真接（ACP / Electron Node 等平台特有方式）：
 *   GrokAdapter（grok agent stdio，ACP）
 *   DshAdapter（Electron Node 模式 headless）
 *   WorkbuddyAdapter（codebuddy --serve --acp，ACP over stdio）
 * - 其余平台由 CatalogAdapter 从目录表自动生成（探测 + runSpec 真接/占位）
 * - AGENTFLEET_BENCH=1 时全部替换为 BenchAdapter（mock 执行，供调度 benchmark）
 */

/** 已有专用 Adapter 的平台，不再由 CatalogAdapter 生成（否则同类型两个实例） */
const DEDICATED_ADAPTER_TYPES: AgentType[] = ['grok', 'dsh', 'workbuddy'];

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
      new WorkbuddyAdapter(),
      ...PLATFORM_CATALOG.filter((def) => !DEDICATED_ADAPTER_TYPES.includes(def.agentType)).map(
        (def) => new CatalogAdapter(def),
      ),
    ];

/** 按 agentType 查找 Adapter */
export function findAdapter(agentType: AgentType): Adapter | undefined {
  return adapters.find((a) => a.agentType === agentType);
}

/** 探测结果缓存：探测用 execFileSync 同步阻塞，重复探测（如 sendCapabilities）会阻塞事件循环
 *  导致心跳延迟、超时断线。启动探测一次后复用缓存；平台登录/环境变化用 refreshAgents 强制刷新。 */
let cachedAgents: AgentInfo[] | null = null;

async function detectAgentsUncached(): Promise<AgentInfo[]> {
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

/** 探测全部平台，返回已安装的 AgentInfo 列表（带缓存，避免同步探测阻塞事件循环） */
export async function detectAllAgents(): Promise<AgentInfo[]> {
  if (cachedAgents) return cachedAgents;
  cachedAgents = await detectAgentsUncached();
  return cachedAgents;
}

/** 强制重新探测（平台登录/环境变化后刷新能力） */
export async function refreshAgents(): Promise<AgentInfo[]> {
  cachedAgents = null;
  return detectAllAgents();
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
