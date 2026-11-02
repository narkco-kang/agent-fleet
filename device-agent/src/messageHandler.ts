import os from 'node:os';
import { spawn } from 'node:child_process';
import type { Envelope, TaskSubmit, AssetDeliver } from '@agentfleet/shared';
import { MESSAGE_TYPES, launchCommandFor, type AgentType, type PlatformOpenAck } from '@agentfleet/shared';
import { loadRegistry, setToken } from './registry.js';
import { config } from './config.js';
import { detectAllAgents, dispatchToAdapter } from './adapters/index.js';
import type { TaskEvent } from '@agentfleet/shared';
import { cryptoRandomId } from '@agentfleet/shared';
import { handleAssetDeliver } from './assetReceiver.js';
import { memoryClient } from './memory/memoryClient.js';
import { encodeChainSummary } from '@agentfleet/memory';
import type { Block, ChainSummary } from '@agentfleet/memory';

/**
 * 设备侧统一消息处理逻辑（传输无关）。
 *
 * lanServer（局域网直连）与 relayClient（中继）复用同一 handleEnvelope，
 * 保证「直连 / 中继」行为一致（03 §6.4）。
 */

export interface MessageSender {
  (envelope: Envelope): void;
}

/** 任务运行状态 */
interface RunningTask {
  agentType: string;
  text: string;
  startedAt: number;
  seq: number;
  cancel: () => void;
}

const runningTasks = new Map<string, RunningTask>();

/** 处理协调服务发来的信封 */
export async function handleEnvelope(
  envelope: Envelope,
  sender: MessageSender,
): Promise<void> {
  const type = envelope.type as string;

  // 记忆同步消息：memory.* 转交本地账本处理
  if (type.startsWith('memory.')) {
    await handleMemoryMessage(type, envelope.payload, sender);
    return;
  }

  switch (type) {
    case MESSAGE_TYPES.DEVICE_PAIR: {
      // 已有 token → 直接 register；否则走 REST 自动配对（协调服务签发签名 token）
      const reg = loadRegistry();
      if (reg.token) {
        sendRegister(sender);
      } else {
        await autoPairAndRegister(sender);
      }
      break;
    }
    case MESSAGE_TYPES.DEVICE_REGISTER_ACK: {
      // 注册确认：登记 coordinator 公钥（供记忆账本验签）
      const ack = envelope.payload as { coordinatorPublicKey?: string };
      if (ack?.coordinatorPublicKey) {
        memoryClient.registerCoordinatorKey(ack.coordinatorPublicKey);
      }
      break;
    }
    case MESSAGE_TYPES.TASK_SUBMIT: {
      await handleTaskSubmit(envelope.payload as TaskSubmit, sender);
      break;
    }
    case MESSAGE_TYPES.TASK_CANCEL: {
      const p = envelope.payload as { taskId: string };
      const rt = runningTasks.get(p.taskId);
      if (rt) {
        rt.cancel();
        runningTasks.delete(p.taskId);
        sendEvent(p.taskId, 'status', 'cancelled', { message: '任务已取消' }, sender);
      }
      break;
    }
    case MESSAGE_TYPES.ASSET_DELIVER: {
      const deliver = envelope.payload as AssetDeliver;
      const ack = handleAssetDeliver(deliver, loadRegistry().deviceId);
      sender({
        v: 1,
        type: MESSAGE_TYPES.ASSET_DELIVER_ACK,
        id: cryptoRandomId('assetack'),
        ts: Date.now(),
        from: loadRegistry().deviceId,
        to: 'coordinator',
        payload: ack,
      });
      break;
    }
    case MESSAGE_TYPES.DEVICE_PLATFORM_OPEN: {
      const p = envelope.payload as { agentType?: string };
      const ack = openPlatformApp(p?.agentType ?? '');
      sender({
        v: 1,
        type: MESSAGE_TYPES.DEVICE_PLATFORM_OPEN_ACK,
        id: cryptoRandomId('popenack'),
        ts: Date.now(),
        from: loadRegistry().deviceId,
        to: 'coordinator',
        payload: ack,
      });
      break;
    }
    default: {
      sendEvent(
        'system',
        'system',
        undefined,
        { message: `未知消息类型: ${type}` },
        sender,
      );
    }
  }
}

/**
 * 自动配对：REST 创建配对码 + 确认配对拿 token，然后注册。
 * 仅用于「协调服务出站直连」降级通道；局域网 mDNS 直连同样适用。
 */
async function autoPairAndRegister(sender: MessageSender): Promise<void> {
  const { deviceId } = loadRegistry();
  const base = config.coordinatorHttpUrl;
  if (!base) {
    // 无法自动配对：降级为本地随机 token（协调服务跳过鉴权时可用）
    setToken(cryptoRandomId('tok'));
    sendRegister(sender);
    return;
  }
  try {
    const create = await fetch(`${base}/api/devices/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, name: config.deviceName }),
    });
    const cj = (await create.json()) as { ok: boolean; data?: { pairingCode: string } };
    if (!cj.ok || !cj.data?.pairingCode) throw new Error('pair create failed');

    const confirm = await fetch(`${base}/api/devices/${deviceId}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: cj.data.pairingCode }),
    });
    const fj = (await confirm.json()) as { ok: boolean; data?: { token: string } };
    if (!fj.ok || !fj.data?.token) throw new Error('pair confirm failed');

    setToken(fj.data.token);
    sendRegister(sender);
  } catch (err) {
    sendEvent(
      'system',
      'status',
      'failed',
      { message: `自动配对失败: ${(err as Error).message}` },
      sender,
    );
  }
}

/** 发送注册消息 */
export function sendRegister(sender: MessageSender): void {
  const reg = loadRegistry();
  sender({
    v: 1,
    type: MESSAGE_TYPES.DEVICE_REGISTER,
    id: cryptoRandomId('reg'),
    ts: Date.now(),
    from: reg.deviceId,
    to: 'coordinator',
    payload: {
      deviceId: reg.deviceId,
      name: config.deviceName,
      hostname: os.hostname(),
      os: {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
      },
      version: config.version,
      token: reg.token,
    },
  });
}

/** 发送能力上报 */
export async function sendCapabilities(sender: MessageSender): Promise<void> {
  const { deviceId } = loadRegistry();
  const agents = await detectAllAgents();
  sender({
    v: 1,
    type: MESSAGE_TYPES.DEVICE_CAPABILITIES,
    id: cryptoRandomId('caps'),
    ts: Date.now(),
    from: deviceId,
    to: 'coordinator',
    payload: { deviceId, agents, ts: Date.now() },
  });
}

/** 处理记忆同步消息（block_broadcast / block_response）。 */
async function handleMemoryMessage(
  type: string,
  payload: unknown,
  _sender: MessageSender,
): Promise<void> {
  if (type === MESSAGE_TYPES.MEMORY_BLOCK_BROADCAST) {
    const { block } = payload as { block: Block };
    await memoryClient.applyBlock(block);
    return;
  }
  if (type === MESSAGE_TYPES.MEMORY_BLOCK_RESPONSE) {
    const { blocks } = payload as { blocks: Block[] };
    await memoryClient.applyBlocks(blocks);
  }
}

/** 上报本地链头，触发 coordinator 补同步（落后则回 block_response）。 */
export async function sendChainSummary(sender: MessageSender): Promise<void> {
  const { deviceId } = loadRegistry();
  const summary = await memoryClient.chainSummary();
  sender(encodeChainSummary(summary, deviceId, 'coordinator') as unknown as Envelope);
}

/** 处理任务下发：派发给 Adapter，流式回传 + 结果回收 */
async function handleTaskSubmit(task: TaskSubmit, sender: MessageSender): Promise<void> {
  const agentType = task.target.agentType ?? 'grok';
  const startedAt = Date.now();
  let seq = 0;
  let text = '';

  const makeSeq = (): number => ++seq;

  const sendTaskEvent = (event: TaskEvent): void => {
    if (event.data?.text) text += event.data.text;
    sender({
      v: 1,
      type: MESSAGE_TYPES.TASK_EVENT,
      id: cryptoRandomId('evt'),
      ts: Date.now(),
      from: loadRegistry().deviceId,
      to: 'coordinator',
      payload: event,
    });

    // 终态 → 回传 task.result（不依赖 runningTasks，避免同步 emit 终态时 rt 尚未 set）
    if (event.status === 'completed' || event.status === 'failed') {
      sender({
        v: 1,
        type: MESSAGE_TYPES.TASK_RESULT,
        id: cryptoRandomId('res'),
        ts: Date.now(),
        from: loadRegistry().deviceId,
        to: 'coordinator',
        payload: {
          taskId: task.taskId,
          status: event.status,
          result: {
            text: text || '',
            exitCode: event.status === 'completed' ? 0 : 1,
            durationMs: Date.now() - startedAt,
            error: event.status === 'failed' ? (event.data?.message ?? '') : undefined,
          },
          logs: [],
          finishedAt: Date.now(),
        },
      });
      runningTasks.delete(task.taskId);
    }
  };

  try {
    const handle = await dispatchToAdapter(agentType, task, sendTaskEvent);
    runningTasks.set(task.taskId, {
      agentType,
      text,
      startedAt,
      seq,
      cancel: handle.cancel,
    });
  } catch (err) {
    sendTaskEvent({
      taskId: task.taskId,
      seq: makeSeq(),
      eventType: 'status',
      status: 'failed',
      data: { message: `任务下发失败: ${(err as Error).message}` },
      ts: Date.now(),
    });
  }
}

/** 打开平台应用：生成启动命令并 detach spawn，回执 PlatformOpenAck */
function openPlatformApp(agentType: string): PlatformOpenAck {
  const deviceId = loadRegistry().deviceId;
  const launch = launchCommandFor(agentType as AgentType, os.platform());
  if (launch.method === 'unsupported') {
    return {
      deviceId,
      agentType: agentType as AgentType,
      ok: false,
      message: launch.note ?? '该平台无法自动打开',
    };
  }
  try {
    const child = spawn(launch.command, { shell: true, detached: true, stdio: 'ignore' });
    child.unref();
    return {
      deviceId,
      agentType: agentType as AgentType,
      ok: true,
      command: launch.command,
      message: '已打开平台应用，请在设备上完成登录激活',
    };
  } catch (err) {
    return {
      deviceId,
      agentType: agentType as AgentType,
      ok: false,
      message: `打开失败: ${(err as Error).message}`,
    };
  }
}

/** 发送任务事件 */
function sendEvent(
  taskId: string,
  eventType: string,
  status: string | undefined,
  data: Record<string, unknown>,
  sender: MessageSender,
): void {
  sender({
    v: 1,
    type: MESSAGE_TYPES.TASK_EVENT,
    id: cryptoRandomId('evt'),
    ts: Date.now(),
    from: loadRegistry().deviceId,
    to: 'coordinator',
    payload: {
      taskId,
      seq: 0,
      eventType,
      status,
      data,
      ts: Date.now(),
    } as TaskEvent,
  });
}
