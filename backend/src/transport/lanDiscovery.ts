import { Bonjour, type Service } from 'bonjour-service';
import WebSocket from 'ws';
import { MDNS_SERVICE_TYPE, MESSAGE_TYPES } from '@agentmesh/shared';
import { deviceRegistry } from '../services/deviceRegistry.js';
import { handleEnvelopeFor, sendEnvelope } from './wsServer.js';

/**
 * 局域网发现：bonjour 浏览 _agentmesh._tcp，发现设备后发起直连。
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
      const host = String(service.addresses?.[0] ?? service.host ?? '');
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
    const entry = deviceRegistry.get(info.deviceId);
    if (entry?.kind === 'lan' && entry.socket === (socket as never)) {
      deviceRegistry.remove(info.deviceId);
    }
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
