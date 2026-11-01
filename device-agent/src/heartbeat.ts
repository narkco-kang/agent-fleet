import os from 'node:os';
import { HEARTBEAT_INTERVAL_MS, MESSAGE_TYPES, cryptoRandomId } from '@agentmesh/shared';
import { loadRegistry } from './registry.js';
import { sendToAll, hasSenders } from './senderRegistry.js';

/**
 * 10s 心跳 + cpu/mem 负载采集（0~1）。
 */
export interface HeartbeatHandle {
  stop(): void;
}

let timer: NodeJS.Timeout | null = null;
let lastCpu: { idle: number; total: number } | null = null;

export function startHeartbeat(): HeartbeatHandle {
  if (timer) return { stop: () => stopHeartbeat() };
  timer = setInterval(() => {
    if (!hasSenders()) return;
    const { deviceId } = loadRegistry();
    const load = sampleLoad();
    sendToAll({
      v: 1,
      type: MESSAGE_TYPES.DEVICE_HEARTBEAT,
      id: cryptoRandomId('hb'),
      ts: Date.now(),
      from: deviceId,
      to: 'coordinator',
      payload: {
        deviceId,
        load,
        busyAgents: 0,
        ts: Date.now(),
      },
    });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return { stop: () => stopHeartbeat() };
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 采集 CPU/内存负载 */
function sampleLoad(): { cpu: number; mem: number } {
  const cpu = sampleCpu();
  const total = os.totalmem();
  const free = os.freemem();
  const mem = total > 0 ? (total - free) / total : 0;
  return { cpu, mem };
}

/** 简单 CPU 占用（两次采样差值，粗略估计） */
function sampleCpu(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev) return 0;
  const dTotal = total - prev.total;
  const dIdle = idle - prev.idle;
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - dIdle / dTotal));
}
