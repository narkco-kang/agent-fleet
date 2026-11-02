import type { AgentType, TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';

/**
 * benchmark 专用 Adapter：走真实消息链路（注册/派发/认领/结果回传），
 * 但执行是可控延迟的 mock，不依赖真实 agent 平台登录态。
 *
 * 由 AGENTFLEET_BENCH=1 启用；BENCH_EXEC_MS 控制单任务延迟，
 * BENCH_MAX_CONCURRENCY 控制每个 mock agent 的并发上限。
 */
export class BenchAdapter implements Adapter {
  readonly agentType: AgentType;
  readonly displayName: string;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(agentType: AgentType) {
    this.agentType = agentType;
    this.displayName = `bench-${agentType}`;
  }

  async detect(): Promise<AdapterDetection> {
    return {
      found: true,
      agentType: this.agentType,
      executable: 'bench',
      version: '1.0.0',
      detectMethod: 'which',
      capabilities: ['bench'],
      maxConcurrency: Number(process.env.BENCH_MAX_CONCURRENCY ?? 2),
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    const execMs = Number(process.env.BENCH_EXEC_MS ?? 20);
    const timer = setTimeout(() => {
      sink({
        taskId: task.taskId,
        seq: 1,
        eventType: 'status',
        status: 'completed',
        data: { text: `ok-from-${this.agentType}` },
        ts: Date.now(),
      });
      this.timers.delete(task.taskId);
    }, execMs);
    this.timers.set(task.taskId, timer);
    return {
      cancel: () => {
        clearTimeout(timer);
        this.timers.delete(task.taskId);
      },
    };
  }

  cancel(taskId: string): void {
    const t = this.timers.get(taskId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(taskId);
    }
  }
}
