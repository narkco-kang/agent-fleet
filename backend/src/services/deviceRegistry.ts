import type WebSocket from 'ws';
import type { DeviceLoad } from '@agentfleet/shared';
import { MISSED_PROBE_LIMIT } from '@agentfleet/shared';
import { config } from '../config.js';
import { setDeviceStatus, setDeviceRelay } from '../db/repo/devices.js';

/** 连接通道类型：局域网直连 WS 或中继透传 */
export type ConnectionKind = 'lan' | 'relay';

/** 在线设备注册表条目 */
export interface DeviceEntry {
  deviceId: string;
  name: string;
  /** 直连 WS 连接（lan 时存在） */
  socket?: WebSocket;
  /** 中继通道（relay 时存在，无需持有 socket，经 relayServer 转发） */
  relay: boolean;
  kind: ConnectionKind;
  lastHeartbeat: number;
  /** 连续心跳 miss 次数（收到心跳归零；≥ MISSED_PROBE_LIMIT 判死，防抖动误杀） */
  missedCount: number;
  load: DeviceLoad;
  busyAgents: number;
  lanAddr?: string;
}

/**
 * 在内存中维护「在线设备 → 连接句柄 + 心跳时间戳」。
 * 这是协调服务下发任务的唯一权威通道来源。
 */
class DeviceRegistry {
  private devices = new Map<string, DeviceEntry>();
  private sweepTimer: NodeJS.Timeout | null = null;

  /**
   * 注册 / 更新设备连接。
   * - lan：直连 WS，socket 就绪后登记。
   * - relay：设备经中继在线，relayServer 会回调此方法登记。
   */
  register(
    deviceId: string,
    name: string,
    kind: ConnectionKind,
    opts: { socket?: WebSocket; lanAddr?: string } = {},
  ): DeviceEntry {
    const prev = this.devices.get(deviceId);
    const entry: DeviceEntry = {
      deviceId,
      name,
      socket: opts.socket,
      relay: kind === 'relay',
      kind,
      lastHeartbeat: Date.now(),
      missedCount: 0,
      load: prev?.load ?? { cpu: 0, mem: 0 },
      busyAgents: prev?.busyAgents ?? 0,
      lanAddr: opts.lanAddr,
    };
    this.devices.set(deviceId, entry);
    setDeviceRelay(deviceId, kind === 'relay');
    if (process.env.AGENTFLEET_DEBUG_RELAY === '1') {
      console.log(`[registry] register ${deviceId} kind=${kind} lastHeartbeat=${entry.lastHeartbeat} now=${Date.now()}`);
    }
    return entry;
  }

  /** 更新心跳 */
  heartbeat(deviceId: string, load: DeviceLoad, busyAgents: number): void {
    const e = this.devices.get(deviceId);
    if (e) {
      e.lastHeartbeat = Date.now();
      e.missedCount = 0; // 收到心跳即归零，容错窗口重开
      e.load = load;
      e.busyAgents = busyAgents;
    }
  }

  /** 获取条目 */
  get(deviceId: string): DeviceEntry | undefined {
    return this.devices.get(deviceId);
  }

  /** 是否在线 */
  isOnline(deviceId: string): boolean {
    const e = this.devices.get(deviceId);
    if (!e) return false;
    // 容错：连续 miss 未达上限仍视为在线（防单次抖动误杀）
    return e.missedCount < MISSED_PROBE_LIMIT;
  }

  /** 删除（直连断开且中继不在线时调用） */
  remove(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  /** 全部条目 */
  all(): DeviceEntry[] {
    return Array.from(this.devices.values());
  }

  /** 全部在线设备 ID */
  onlineIds(): string[] {
    return this.all()
      .filter((e) => this.isOnline(e.deviceId))
      .map((e) => e.deviceId);
  }

  /** 定时清扫：心跳超时累计连续 miss，达 MISSED_PROBE_LIMIT 才标记 offline（1s 间隔，防抖动误杀） */
  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const e of this.devices.values()) {
        if (now - e.lastHeartbeat > config.heartbeatTimeoutMs) {
          e.missedCount += 1;
          if (e.missedCount >= MISSED_PROBE_LIMIT) {
            this.devices.delete(e.deviceId);
            setDeviceStatus(e.deviceId, 'offline');
            if (process.env.AGENTFLEET_DEBUG_RELAY === '1') {
              console.log(
                `[registry] sweep 判定离线 ${e.deviceId} miss=${e.missedCount} age=${now - e.lastHeartbeat}ms`,
              );
            }
            offlineHandler?.(e.deviceId);
          }
        }
      }
    }, 1_000);
    this.sweepTimer.unref();
  }

  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

/** 全局单例 */
export const deviceRegistry = new DeviceRegistry();

/** 心跳超时兜底回调（index.ts 注入 taskRunner.onDeviceDisconnected，标 interrupted） */
let offlineHandler: ((deviceId: string) => void) | null = null;

/** 注入心跳超时兜底回调 */
export function setDeviceOfflineHandler(fn: (deviceId: string) => void): void {
  offlineHandler = fn;
}
