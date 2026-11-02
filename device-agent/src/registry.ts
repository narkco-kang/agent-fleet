import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * 本机 deviceId + token 持久化（首启生成，存 ~/.agentfleet/registry.json）。
 */
export interface DeviceRegistryData {
  deviceId: string;
  token: string;
  createdAt: number;
}

let cache: DeviceRegistryData | null = null;

function registryPath(): string {
  return path.join(config.dataDir, 'registry.json');
}

/** 生成唯一 deviceId（本地设备维度） */
function generateDeviceId(): string {
  return `dev-${crypto.randomUUID()}`;
}

/** 读取 / 生成本机设备身份 */
export function loadRegistry(): DeviceRegistryData {
  if (cache) return cache;
  const file = registryPath();
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as DeviceRegistryData;
      if (data?.deviceId) {
        cache = data;
        return data;
      }
    } catch {
      /* 损坏则重建 */
    }
  }
  const fresh: DeviceRegistryData = {
    deviceId: generateDeviceId(),
    token: '',
    createdAt: Date.now(),
  };
  saveRegistry(fresh);
  cache = fresh;
  return fresh;
}

/** 保存身份 */
export function saveRegistry(data: DeviceRegistryData): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(data, null, 2));
  cache = data;
}

/** 更新 token（配对成功后） */
export function setToken(token: string): void {
  const data = loadRegistry();
  data.token = token;
  saveRegistry(data);
}
