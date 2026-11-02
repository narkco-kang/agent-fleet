import { Bonjour, type Service } from 'bonjour-service';
import WebSocket from 'ws';
import { MDNS_SERVICE_TYPE, MESSAGE_TYPES } from '@agentfleet/shared';
import { deviceRegistry } from '../services/deviceRegistry.js';
import {
  handleEnvelopeFor,
  sendEnvelope,
  notifyDeviceDisconnected,
  armDevicePingPong,
} from './wsServer.js';

/** 反向连接 open 后存活验证窗口：超过此时间未收到任何消息即判定死连接 */
const OPEN_VERIFY_MS = 3_000;

/**
 * 局域网发现：bonjour 浏览 _agentfleet._tcp，发现设备后发起直连。
 * 直连成功后，协调服务向设备本地 WS 发 device.pair（若未配对）→ 设备回 register。
 *
 * 出站直连与入站连接复用同一套 `handleEnvelopeFor` 消息处理逻辑，
 * 保证「直连 / 中继」行为一致（03 §6.4）。
 */

interface ServiceInfo {
  deviceId: string;
  name: string;
  host: string;
  port: number;
  version?: string;
}

let bonjour: Bonjour | null = null;
let browser: ReturnType<Bonjour['find']> | null = null;

/** 已发起的直连设备（避免重复连接） */
const connectedDevices = new Set<string>();

/** 启动局域网发现 */
export function startLanDiscovery(): void {
  try {
    bonjour = new Bonjour();
    browser = bonjour.find({ type: MDNS_SERVICE_TYPE });
    browser.on('up', (service: Service) => {
      const txt = asRecord(service.txt);
      const deviceId = txt.deviceId;
      const host = pickHost(service);
      const port = Number(service.port ?? 0);
      if (!deviceId || !host || !port) return;

      const info: ServiceInfo = {
        deviceId,
        name: txt.name ?? deviceId,
        host,
        port,
        version: txt.version,
      };
      if (connectedDevices.has(deviceId)) return;
      connectedDevices.add(deviceId);
      connectDevice(info);
    });
    console.log(`[lan] mDNS 浏览器已启动，监听 ${MDNS_SERVICE_TYPE}`);
  } catch (err) {
    console.warn('[lan] mDNS 浏览器启动失败（沙箱受限时降级为配置直连）:', (err as Error).message);
  }
}

/** 停止局域网发现 */
export function stopLanDiscovery(): void {
  browser?.removeAllListeners?.();
  browser?.stop?.();
  browser = null;
  bonjour?.destroy?.();
  bonjour = null;
}

/** 发起设备直连 */
function connectDevice(info: ServiceInfo): void {
  const url = `ws://${info.host}:${info.port}/ws`;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    console.warn(`[lan] 连接设备 ${info.deviceId} 失败:`, (err as Error).message);
    return;
  }

  const peer = { kind: 'device' as const, deviceId: info.deviceId, socket: socket as never };

  socket.on('open', () => {
    console.log(`[lan] 已直连设备 ${info.name} (${info.deviceId}) @ ${url}`);
    deviceRegistry.register(info.deviceId, info.name, 'lan', {
      socket: socket as never,
      lanAddr: `${info.host}:${info.port}`,
    });
    // 先发 pair（设备首启 token 为空则回 pair_ack 后 register）
    sendEnvelope(socket as never, {
      v: 1,
      type: MESSAGE_TYPES.DEVICE_PAIR,
      id: `pair-${Date.now()}`,
      ts: Date.now(),
      from: 'coordinator',
      to: info.deviceId,
      payload: { deviceId: info.deviceId, name: info.name },
    });
    // 反向连接同样加 ws ping/pong 探活（设备 SIGKILL 后秒级识别死连接）
    armDevicePingPong(socket as never);
    // 存活验证：open 后 OPEN_VERIFY_MS 内必须收到至少一条消息（如 register 响应），
    // 否则判定为「进程已死、TCP 握手却完成」的竞态连接，主动关闭避免反复 register 重置 lastHeartbeat
    let gotMessage = false;
    const markAlive = (): void => {
      gotMessage = true;
    };
    socket.on('message', markAlive);
    const verifyTimer = setTimeout(() => {
      if (!gotMessage) {
        console.log(`[lan] 设备 ${info.deviceId} open 后无响应，判定死连接并关闭`);
        socket.terminate();
      }
      socket.removeListener('message', markAlive);
    }, OPEN_VERIFY_MS);
    verifyTimer.unref();
  });

  socket.on('message', (data) => {
    const text = Buffer.isBuffer(data)
      ? data.toString('utf-8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf-8')
        : Buffer.concat(data as Buffer[]).toString('utf-8');
    handleEnvelopeFor(socket as never, text, peer);
  });

  socket.on('close', () => {
    connectedDevices.delete(info.deviceId);
    // 反向连接断开 → 统一走断连处理（标 interrupted + 移除），与入站连接行为一致
    notifyDeviceDisconnected(info.deviceId);
  });

  socket.on('error', (err) => {
    console.warn(`[lan] 设备 ${info.deviceId} 连接错误:`, err.message);
  });
}

/** 将 unknown txt 记录转换为 Record<string,string> */
function asRecord(txt: unknown): Record<string, string> {
  if (!txt || typeof txt !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(txt as Record<string, unknown>)) {
    out[k] = String(v);
  }
  return out;
}

/**
 * 从 mDNS 地址中选一个可直连的 host：优先 IPv4，其次非 link-local IPv6，
 * 过滤掉 fe80::（link-local，无法作为 ws:// 目标，会产生 Invalid URL 噪音）。
 */
function pickHost(service: Service): string {
  const addrs = (service.addresses ?? []).map((a) => String(a));
  const ipv4 = addrs.find((a) => a && !a.includes(':'));
  if (ipv4) return ipv4;
  const ipv6 = addrs.find((a) => a && a.includes(':') && !a.startsWith('fe80:'));
  if (ipv6) return ipv6;
  const host = String(service.host ?? '');
  return host && !host.startsWith('fe80:') ? host : '';
}
