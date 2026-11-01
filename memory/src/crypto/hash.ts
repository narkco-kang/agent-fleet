/**
 * sha256 封装（node:crypto，零第三方依赖）。
 * 统一输出 64 位小写 hex（对齐 amg SHA256_RE = ^[0-9a-f]{64}$）。
 */
import { createHash } from 'node:crypto';

/** 计算 sha256 并返回 64 位小写 hex。 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
