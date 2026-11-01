import type { AgentInfo, AgentType, TaskEvent, TaskSubmit } from '@agentmesh/shared';

/**
 * 统一 Adapter 接口：把异构平台（codex/claude/dsh/grok）统一为
 * detect() / run() / cancel()，流式输出规范为 TaskEvent。
 */

/** 探测结果 */
export interface AdapterDetection {
  found: boolean;
  agentType: AgentType;
  executable: string;
  version: string;
  detectMethod: AgentInfo['detectMethod'];
  capabilities: string[];
  maxConcurrency: number;
}

/** 运行回调：把规范化事件回传上层（lanServer / relayClient） */
export type AdapterEventSink = (event: TaskEvent) => void;

/** 运行句柄：持有子进程，可取消 */
export interface AdapterRunHandle {
  cancel(): void;
}

/** 统一 Adapter 接口 */
export interface Adapter {
  readonly agentType: AgentType;
  readonly displayName: string;

  /** 探测本机是否安装 + 版本 + 可执行路径 */
  detect(): Promise<AdapterDetection>;

  /** 运行任务（prompt → 流式事件 → 返回 handle） */
  run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle>;

  /** 取消任务 */
  cancel(taskId: string): void;
}

/**
 * 占位 Adapter 基类：提供统一「未实现」run 骨架（不崩溃，明确失败）。
 * codex/claude/dsh 三个平台复用此骨架；detect 由各子类覆盖。
 */
export abstract class PlaceholderAdapter implements Adapter {
  abstract readonly agentType: AgentType;
  abstract readonly displayName: string;
  protected abstract probeCommand(): string;
  protected abstract probeDirs(): string[];

  abstract detect(): Promise<AdapterDetection>;

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    sink({
      taskId: task.taskId,
      seq: 1,
      eventType: 'status',
      status: 'failed',
      data: { message: `${this.displayName} Adapter 暂未接入（接口骨架已就绪）` },
      ts: Date.now(),
    });
    return { cancel: () => undefined };
  }

  cancel(_taskId: string): void {
    /* 无子进程可取消 */
  }
}
