import type { TaskSubmit } from '@agentmesh/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { detectPlatform } from './detector.js';
import type { PlatformDef } from './platformCatalog.js';

/**
 * 通用 Adapter（数据驱动）：从 platformCatalog 读取探测配置，
 * 自动检测本机是否安装 + 版本 + 可执行路径；run 为占位（已探测但执行待接入）。
 * 新增平台无需写新类，只需在 catalog 加一条记录。
 */
export class CatalogAdapter implements Adapter {
  readonly agentType: PlatformDef['agentType'];
  readonly displayName: string;
  private readonly def: PlatformDef;

  constructor(def: PlatformDef) {
    this.def = def;
    this.agentType = def.agentType;
    this.displayName = def.displayName;
  }

  async detect(): Promise<AdapterDetection> {
    const r = detectPlatform(this.def);
    return {
      found: r.found,
      agentType: this.agentType,
      executable: r.executable,
      version: r.version,
      detectMethod: r.detectMethod,
      capabilities: this.def.capabilities,
      maxConcurrency: this.def.maxConcurrency,
    };
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    sink({
      taskId: task.taskId,
      seq: 1,
      eventType: 'status',
      status: 'failed',
      data: { message: `${this.displayName} 已检测接入，任务执行待接入（接口骨架已就绪）` },
      ts: Date.now(),
    });
    return { cancel: () => undefined };
  }

  cancel(_taskId: string): void {
    /* 无子进程可取消 */
  }
}
