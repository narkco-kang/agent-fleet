import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Envelope, SubRole, TaskSubmit } from '@agentfleet/shared';
import { MESSAGE_TYPES } from '@agentfleet/shared';
import { buildSystemPrompt } from '../src/services/swarm/personaBuilder.js';

/**
 * 设备端 persona 合并验收（回归保护）。
 *
 * messageHandler.handleTaskSubmit 的契约：
 * - task.systemPrompt 存在 → prompt = `${systemPrompt}\n\n---\n\n任务指令：\n${prompt}`
 * - task.systemPrompt 缺失/空串 → prompt 完全不变（老链路行为不变）
 *
 * Adapter 被 mock，只观察最终交给 adapter 的任务，不真正 spawn 平台进程。
 */

// 设备端数据目录隔离（registry.json / memory 账本落盘位置），必须在 import device-agent 前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-device-merge-'));

vi.mock('../../device-agent/src/adapters/index.js', () => ({
  detectAllAgents: vi.fn(async () => []),
  dispatchToAdapter: vi.fn(),
}));

let handleEnvelope: (envelope: Envelope, sender: (e: Envelope) => void) => Promise<void>;
const captured: TaskSubmit[] = [];
const sent: Envelope[] = [];

function makeEnvelope(payload: TaskSubmit): Envelope {
  return {
    v: 1,
    type: MESSAGE_TYPES.TASK_SUBMIT,
    id: `submit-${payload.taskId}`,
    ts: Date.now(),
    from: 'coordinator',
    to: 'device',
    payload,
  } as Envelope;
}

function makeTask(over: Partial<TaskSubmit> = {}): TaskSubmit {
  return {
    taskId: 'task-1',
    sessionId: 'sess-1',
    origin: 'dashboard',
    originRef: 'qa',
    prompt: '请实现登录接口',
    target: { mode: 'swarm', deviceId: 'dev-1', agentType: 'codex' },
    options: {},
    createdAt: Date.now(),
    ...over,
  };
}

beforeAll(async () => {
  process.env.DEVICE_DATA_DIR = dataDir;
  const adapters = await import('../../device-agent/src/adapters/index.js');
  (adapters.dispatchToAdapter as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
    async (_agentType: string, task: TaskSubmit) => {
      captured.push(task);
      return { cancel: () => undefined };
    },
  );
  const mod = await import('../../device-agent/src/messageHandler.js');
  handleEnvelope = mod.handleEnvelope as typeof handleEnvelope;
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  captured.length = 0;
  sent.length = 0;
});

describe('设备端 systemPrompt 合并', () => {
  it('有 systemPrompt → 注入为 prompt 前缀（含固定分隔符与「任务指令：」）', async () => {
    await handleEnvelope(makeEnvelope(makeTask({ systemPrompt: '你是「工程师」角色。' })), (e) => sent.push(e));

    expect(captured).toHaveLength(1);
    expect(captured[0].prompt).toBe('你是「工程师」角色。\n\n---\n\n任务指令：\n请实现登录接口');
  });

  it('无 systemPrompt → prompt 完全不变（回归保护）', async () => {
    await handleEnvelope(makeEnvelope(makeTask()), (e) => sent.push(e));

    expect(captured).toHaveLength(1);
    expect(captured[0].prompt).toBe('请实现登录接口');
    expect(captured[0].systemPrompt).toBeUndefined();
  });

  it('systemPrompt 为空串 → 视为无注入，prompt 不变', async () => {
    await handleEnvelope(makeEnvelope(makeTask({ systemPrompt: '' })), (e) => sent.push(e));

    expect(captured[0].prompt).toBe('请实现登录接口');
  });

  it('后端 personaBuilder 产物可完整合并到设备侧 prompt', async () => {
    const subRole: SubRole = {
      subRoleId: 'sr-1',
      roleTeamId: 'rteam-1',
      slug: 'engineer',
      name: '工程师',
      description: '负责功能实现',
      capabilities: ['coding'],
      persona: {
        identity: '你是一名一线软件工程师。',
        communication: '汇报进展与阻塞。',
        rules: ['遵循项目规范', '不留 TODO'],
        style: '务实、精确。',
      },
      operation: {
        mission: '高质量实现既定功能。',
        workflow: ['阅读代码', '实现功能'],
        deliverables: ['可运行代码'],
      },
      requiredCapabilities: ['coding'],
      position: 0,
    };
    const systemPrompt = buildSystemPrompt(subRole);
    expect(systemPrompt.length).toBeGreaterThan(0);

    await handleEnvelope(makeEnvelope(makeTask({ systemPrompt })), (e) => sent.push(e));

    const merged = captured[0].prompt;
    // persona 全部内容原样保留在合并结果中
    expect(merged).toContain(systemPrompt);
    expect(merged).toContain('你是一名一线软件工程师。');
    expect(merged).toContain('1. 阅读代码');
    expect(merged.startsWith(systemPrompt)).toBe(true);
    expect(merged.endsWith('请实现登录接口')).toBe(true);
  });

  it('合并只作用于交给 adapter 的任务，事件里回传的 taskId 不变', async () => {
    await handleEnvelope(
      makeEnvelope(makeTask({ taskId: 'task-merge-id', systemPrompt: 'CTX' })),
      (e) => sent.push(e),
    );

    expect(captured[0].taskId).toBe('task-merge-id');
    expect(captured[0].target.agentType).toBe('codex');
  });
});
