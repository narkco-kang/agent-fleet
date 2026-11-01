import type { AgentInfo, AgentType, TaskSubmit } from '@agentmesh/shared';
import type { Adapter, AdapterEventSink } from './adapter.js';
import { GrokAdapter } from './grokAdapter.js';
import { CatalogAdapter } from './catalogAdapter.js';
import { PLATFORM_CATALOG } from './platformCatalog.js';

/**
 * Adapter 注册表：统一探测 + 按类型查找 + 任务派发。
 * - GrokAdapter 真接（已接入任务执行）
 * - 其余平台由 CatalogAdapter 从目录表自动生成（探测 + 接口骨架）
 */
export const adapters: Adapter[] = [
  new GrokAdapter(),
  ...PLATFORM_CATALOG.map((def) => new CatalogAdapter(def)),
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
