import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DEVICE_DATA_DIR } from '@agentmesh/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(rootDir, '.env') });

/** 设备守护运行配置 */
export interface DeviceAgentConfig {
  deviceName: string;
  /** 设备本地 WS 端口（0 = 随机） */
  port: number;
  /** 协调服务直连地址（mDNS 不可用时降级） */
  coordinatorUrl: string;
  /** 协调服务 HTTP 地址（自动配对 REST 调用） */
  coordinatorHttpUrl: string;
  /** 中继地址（云端兜底） */
  relayUrl: string;
  /** 设备持久化目录 */
  dataDir: string;
  /** 守护版本 */
  version: string;
}

/** 展开 ~ 为 home 目录 */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** 从 ws:// 地址推导 http:// 地址 */
function deriveHttpUrl(wsUrl: string): string {
  if (!wsUrl) return '';
  try {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/';
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

const coordinatorUrl = process.env.COORDINATOR_URL ?? '';

export const config: DeviceAgentConfig = {
  deviceName: process.env.DEVICE_NAME ?? `${os.hostname()}`,
  port: Number(process.env.DEVICE_AGENT_PORT ?? 0),
  coordinatorUrl,
  coordinatorHttpUrl: process.env.COORDINATOR_HTTP_URL ?? deriveHttpUrl(coordinatorUrl),
  relayUrl: process.env.RELAY_URL ?? '',
  dataDir: path.resolve(expandHome(process.env.DEVICE_DATA_DIR ?? DEVICE_DATA_DIR)),
  version: '0.1.0',
};
