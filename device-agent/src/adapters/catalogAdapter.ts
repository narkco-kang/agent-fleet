import type { TaskSubmit } from '@agentfleet/shared';
import type { Adapter, AdapterDetection, AdapterEventSink, AdapterRunHandle } from './adapter.js';
import { detectPlatform } from './detector.js';
import type { PlatformDef } from './platformCatalog.js';
import { runCli } from './cliRunner.js';
import { runAcpPrompt } from '../runner/acpClient.js';

/** 随机高位端口（避开知名端口与桌面应用常用固定端口段） */
function randomHighPort(): number {
  return 40000 + Math.floor(Math.random() * 15000);
}

/**
 * 通用 Adapter（数据驱动）：从 platformCatalog 读取探测 + 执行配置。
 * - detect：自动检测本机是否安装 + 版本 + 可执行路径
 * - run：有 runSpec 的平台走统一 CLI 生命周期（start→stream→terminal）真接；
 *        无 runSpec 的平台走占位失败并附「待接入」说明（诚实口径）
 * 新增平台无需写新类，只需在 catalog 加一条记录。
 */
export class CatalogAdapter implements Adapter {
  readonly agentType: PlatformDef['agentType'];
  readonly displayName: string;
  private readonly def: PlatformDef;
  private handles = new Map<string, AdapterRunHandle>();

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

  /**
   * 展开参数模板。
   *
   * 支持的占位符：
   * - `{prompt}`：任务文本
   * - `{port}`：随机高位端口。某些 CLI（如 codebuddy）默认绑一个固定端口，
   *   只要同名桌面应用在运行就会 EADDRINUSE 启动失败，必须每次给一个端口。
   */
  private buildArgs(template: string[], prompt: string): string[] {
    return template.map((arg) => {
      if (arg === '{prompt}') return prompt;
      if (arg === '{port}') return String(randomHighPort());
      return arg;
    });
  }

  async run(task: TaskSubmit, sink: AdapterEventSink): Promise<AdapterRunHandle> {
    const spec = this.def.runSpec;

    // 无执行配置 → 占位失败（诚实口径：说明待接入）
    if (!spec || spec.mode === 'unsupported') {
      sink({
        taskId: task.taskId,
        seq: 1,
        eventType: 'status',
        status: 'failed',
        data: { message: `${this.displayName} 执行待接入（${spec?.note ?? 'headless 方式未确认'}）` },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    const detection = await this.detect();
    if (!detection.found) {
      sink({
        taskId: task.taskId,
        seq: 1,
        eventType: 'status',
        status: 'failed',
        data: { message: `未检测到 ${this.displayName} 可执行文件` },
        ts: Date.now(),
      });
      return { cancel: () => undefined };
    }

    // ACP 模式：走 runAcpPrompt（复用 grok 的 ACP 客户端，spawnArgs 由 catalog 指定，如 kimi 为 ['acp']）
    if (spec.mode === 'acp') {
      let seq = 0;
      const makeSeq = (): number => ++seq;
      const handle = runAcpPrompt({
        cmd: detection.executable,
        cwd: process.cwd(),
        prompt: task.prompt,
        agentProfile: task.target.agentProfile,
        spawnArgs: spec.spawnArgs,
        agentLabel: this.displayName,
        skipAuthenticate: spec.skipAuthenticate,
        onEvent: (ev) => {
          const ts = Date.now();
          switch (ev.type) {
            case 'text':
              sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'text', data: { text: ev.text }, ts });
              break;
            case 'thinking':
              sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'thinking', data: { text: ev.text }, ts });
              break;
            case 'tool':
              sink({
                taskId: task.taskId,
                seq: makeSeq(),
                eventType: 'tool_call',
                data: { toolName: ev.toolName, toolInput: ev.toolInput as Record<string, unknown> },
                ts,
              });
              break;
            case 'status':
              sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'status', data: { message: ev.message }, ts });
              break;
            case 'done':
              sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'status', status: 'completed', data: { message: `${this.displayName} 执行完成` }, ts });
              break;
            case 'error':
              sink({ taskId: task.taskId, seq: makeSeq(), eventType: 'status', status: 'failed', data: { message: ev.message }, ts });
              break;
          }
        },
      });
      const runHandle: AdapterRunHandle = { cancel: () => handle.cancel() };
      this.handles.set(task.taskId, runHandle);
      return runHandle;
    }

    // cli-stream / cli-text：统一 CLI 生命周期（start→stream→terminal + 故障归因）
    const args = this.buildArgs(spec.args ?? [], task.prompt);
    const handle = runCli({
      taskId: task.taskId,
      cmd: detection.executable,
      args,
      cwd: process.cwd(),
      streamJson: spec.streamJson,
      textOutput: spec.textOutput,
      timeoutMs: task.options.timeoutMs,
      sandbox: task.options.sandbox,
      onEvent: sink,
    });
    this.handles.set(task.taskId, handle);
    return handle;
  }

  cancel(taskId: string): void {
    this.handles.get(taskId)?.cancel();
    this.handles.delete(taskId);
  }
}
