import crypto from 'node:crypto';
import { PAIR_CODE_LENGTH, PAIR_CODE_TTL_MS } from '@agentfleet/shared';

/**
 * 设备配对码：首次连接时短 TTL 6 位数字码。
 */

interface PendingPair {
  deviceId: string;
  name: string;
  code: string;
  expiresAt: number;
}

/** 内存中的待配对记录 */
const pendingPairs = new Map<string, PendingPair>();

/** 生成一个 6 位数字配对码 */
export function generatePairCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(PAIR_CODE_LENGTH, '0');
}

/** 登记待配对设备，返回配对码 */
export function createPairing(deviceId: string, name: string, ttlMs?: number): string {
  const code = generatePairCode();
  const ttl = ttlMs ?? PAIR_CODE_TTL_MS;
  pendingPairs.set(deviceId, {
    deviceId,
    name,
    code,
    expiresAt: Date.now() + ttl,
  });
  // 过期自动清理
  setTimeout(() => {
    const p = pendingPairs.get(deviceId);
    if (p && p.expiresAt <= Date.now()) pendingPairs.delete(deviceId);
  }, ttl).unref();
  return code;
}

/** 校验配对码（成功返回设备名，失败返回 null） */
export function verifyPairing(deviceId: string, code: string): string | null {
  const p = pendingPairs.get(deviceId);
  if (!p) return null;
  if (p.expiresAt <= Date.now()) {
    pendingPairs.delete(deviceId);
    return null;
  }
  if (p.code !== code) return null;
  pendingPairs.delete(deviceId);
  return p.name;
}

/** 当前是否有待配对记录（供设备列表展示配对码） */
export function getPendingPair(deviceId: string): PendingPair | undefined {
  const p = pendingPairs.get(deviceId);
  if (p && p.expiresAt > Date.now()) return p;
  pendingPairs.delete(deviceId);
  return undefined;
}

/** 清除配对记录 */
export function clearPairing(deviceId: string): void {
  pendingPairs.delete(deviceId);
}
