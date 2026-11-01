import type {
  AgentSnapshot,
  DeviceSnapshot,
  TaskEvent,
  TaskEventData,
  TaskSnapshot,
} from '@agentmesh/shared';
import { mockAgents, mockDevices } from './mockData';

/**
 * Mock 演示引擎：后端无真实设备接入时，驱动一场持续「活」的跨设备协同演示——
 * 任务自动走完 queued → running → completed 全生命周期，流式事件持续流动，
 * 设备负载 / agent 忙碌状态联动，手机设备周期上线/离线（演示断线场景）。
 */
type AgentType = AgentSnapshot['agentType'];

interface ScriptEvent {
  eventType: TaskEvent['eventType'];
  data: TaskEventData;
}

interface Scenario {
  deviceId: string;
  agentType: AgentType;
  prompt: string;
  origin: TaskSnapshot['origin'];
  result: string;
  script: ScriptEvent[];
}

function makeScript(prompt: string): ScriptEvent[] {
  return [
    { eventType: 'thinking', data: { text: `分析「${prompt}」的目标与上下文…` } },
    { eventType: 'tool_call', data: { toolName: 'grep', toolInput: { pattern: '关键词', path: 'src/' } } },
    { eventType: 'tool_result', data: { toolOutput: '定位到 3 处相关位置。' } },
    { eventType: 'thinking', data: { text: '根因已确认，开始修改…' } },
    { eventType: 'tool_call', data: { toolName: 'edit', toolInput: { path: 'src/index.ts' } } },
    { eventType: 'text', data: { text: `「${prompt}」已完成。` } },
    { eventType: 'text', data: { delta: '自校验通过，无回归。' } },
  ];
}

/** 跨设备协同演示场景：MacBook(grok/claude) + PC-Win(codex/dsh) 轮转 */
const SCENARIOS: Scenario[] = [
  {
    deviceId: 'dev-macbook',
    agentType: 'grok',
    prompt: '修复登录超时 bug',
    origin: 'dashboard',
    result: '已修复 token 刷新定时器未清理的问题，登录超时不再复现。',
    script: makeScript('修复登录超时 bug'),
  },
  {
    deviceId: 'dev-pcwin',
    agentType: 'codex',
    prompt: '生成季度营收图表',
    origin: 'wechat_work',
    result: '已生成 Q3 营收折线图，同比增长 24%。',
    script: makeScript('生成季度营收图表'),
  },
  {
    deviceId: 'dev-macbook',
    agentType: 'claude',
    prompt: '重构消息队列模块',
    origin: 'dashboard',
    result: '消息队列已重构为发布订阅模式，解耦生产与消费。',
    script: makeScript('重构消息队列模块'),
  },
  {
    deviceId: 'dev-pcwin',
    agentType: 'dsh',
    prompt: '清理磁盘与旧日志',
    origin: 'wechat_work',
    result: '已清理 12GB 旧日志与缓存，磁盘占用下降 31%。',
    script: makeScript('清理磁盘与旧日志'),
  },
  {
    deviceId: 'dev-macbook',
    agentType: 'grok',
    prompt: '补充核心模块单元测试',
    origin: 'dashboard',
    result: '新增 15 个单元测试，覆盖核心路径，覆盖率提升到 82%。',
    script: makeScript('补充核心模块单元测试'),
  },
  {
    deviceId: 'dev-pcwin',
    agentType: 'codex',
    prompt: '排查内存泄漏',
    origin: 'wechat_personal',
    result: '定位到事件监听未解绑导致泄漏，已修复并验证内存稳定。',
    script: makeScript('排查内存泄漏'),
  },
];

interface Job {
  task: TaskSnapshot;
  scenario: Scenario;
  state: 'queued' | 'running' | 'done';
  step: number;
  startedAt: number;
}

export interface MockEngineDeps {
  upsertTask: (t: Partial<TaskSnapshot> & { taskId: string }) => void;
  appendEvent: (e: TaskEvent) => void;
  upsertDevice: (d: DeviceSnapshot, agents?: AgentSnapshot[]) => void;
}

export class MockEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 1000;
  private taskCounter = 3000;
  private scenarioIdx = 0;
  private tickCount = 0;
  private jobs: Job[] = [];
  private devices: DeviceSnapshot[];
  private agents: AgentSnapshot[];

  constructor(private deps: MockEngineDeps) {
    this.devices = mockDevices.map((d) => ({ ...d }));
    this.agents = mockAgents.map((a) => ({ ...a }));
  }

  start(): void {
    if (this.timer) return;
    // 立即生成两个任务并派发一个 running，让图一打开就有活动
    this.spawn();
    this.spawn();
    this.dispatchQueued();
    this.sync();
    this.timer = setInterval(() => this.tick(), 1500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.tickCount++;
    this.advanceRunning();
    this.dispatchQueued();
    this.spawnIfNeeded();
    this.togglePhone();
    this.sync();
  }

  private agentKey(job: Job): string {
    return `${job.scenario.deviceId}:${job.scenario.agentType}`;
  }

  /** 推进 running 任务的事件步，走完即完成 */
  private advanceRunning(): void {
    for (const job of this.jobs) {
      if (job.state !== 'running') continue;
      job.step++;
      const script = job.scenario.script;
      if (job.step <= script.length) {
        const ev = script[job.step - 1];
        this.deps.appendEvent({
          taskId: job.task.taskId,
          seq: this.seq++,
          eventType: ev.eventType,
          data: ev.data,
          ts: Date.now(),
        });
      }
      if (job.step >= script.length) {
        const duration = Date.now() - job.startedAt;
        this.deps.upsertTask({
          taskId: job.task.taskId,
          status: 'completed',
          resultText: job.scenario.result,
          durationMs: duration,
          finishedAt: Date.now(),
        });
        job.state = 'done';
      }
    }
    this.jobs = this.jobs.filter((j) => j.state !== 'done');
  }

  /** queued → running：找空闲 agent（maxConcurrency 约束 + 设备在线） */
  private dispatchQueued(): void {
    const busy = new Set<string>();
    for (const j of this.jobs) if (j.state === 'running') busy.add(this.agentKey(j));
    for (const job of this.jobs) {
      if (job.state !== 'queued') continue;
      const key = this.agentKey(job);
      if (busy.has(key)) continue;
      const dev = this.devices.find((d) => d.deviceId === job.scenario.deviceId);
      if (!dev || dev.status === 'offline') continue;
      job.state = 'running';
      job.startedAt = Date.now();
      busy.add(key);
      this.deps.upsertTask({ taskId: job.task.taskId, status: 'running', startedAt: job.startedAt });
    }
  }

  /** 保持队列里有待派发任务 */
  private spawnIfNeeded(): void {
    if (this.jobs.length >= 3) return;
    this.spawn();
  }

  private spawn(): void {
    const scenario = SCENARIOS[this.scenarioIdx % SCENARIOS.length];
    this.scenarioIdx++;
    const taskId = `task-${this.taskCounter++}`;
    const now = Date.now();
    const task: TaskSnapshot = {
      taskId,
      sessionId: `session-${taskId}`,
      origin: scenario.origin,
      prompt: scenario.prompt,
      status: 'queued',
      targetMode: 'auto',
      targetDeviceId: scenario.deviceId,
      targetAgentType: scenario.agentType,
      resultText: null,
      durationMs: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs.push({ task, scenario, state: 'queued', step: 0, startedAt: 0 });
    this.deps.upsertTask(task);
  }

  /** 手机设备周期上线/下线，演示断线场景 */
  private togglePhone(): void {
    if (this.tickCount % 24 !== 0) return; // 约 36s 切换一次
    const phone = this.devices.find((d) => d.deviceId === 'dev-phone');
    if (!phone) return;
    phone.status = phone.status === 'offline' ? 'online' : 'offline';
    if (phone.status === 'online') phone.lastHeartbeat = Date.now();
  }

  /** 联动刷新设备负载 + agent 忙碌状态 */
  private sync(): void {
    for (const dev of this.devices) {
      const runningCount = this.jobs.filter(
        (j) => j.state === 'running' && j.scenario.deviceId === dev.deviceId,
      ).length;
      const base = dev.status === 'offline' ? 0 : 0.15;
      const cpu = Math.min(0.95, base + runningCount * 0.3);
      const mem = Math.min(0.9, (dev.status === 'offline' ? 0.25 : 0.35) + runningCount * 0.15);
      dev.load = { cpu: Math.round(cpu * 100) / 100, mem: Math.round(mem * 100) / 100 };
      dev.busyAgents = runningCount;

      const devAgents = this.agents
        .filter((a) => a.deviceId === dev.deviceId)
        .map((a) => {
          const running = this.jobs.filter(
            (j) => j.state === 'running' && `${j.scenario.deviceId}:${j.scenario.agentType}` === `${a.deviceId}:${a.agentType}`,
          ).length;
          return {
            ...a,
            busyCount: running,
            status: (running > 0 ? 'busy' : 'available') as AgentSnapshot['status'],
          };
        });

      this.deps.upsertDevice({ ...dev }, devAgents);
    }
  }
}
