/**
 * 建议锁（flock 语义的 Node 实现）：锁文件 .lock 与账本同目录。
 *
 * - 通过「独占创建锁文件 + 写入持有者 pid」模拟 POSIX flock 语义。
 * - 崩溃安全：若持有进程已死（pid 不可达），锁被判定为 stale 并回收，避免楔死。
 * - 回退指数退避（1ms 起步、16ms 封顶、加抖动），防等锁方步调一致碰撞。
 */
import { constants } from 'node:fs';
import { open, readFile, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { ERROR_CODES } from '../types';

export interface LockOptions {
  /** 获取锁总超时（毫秒）。 */
  timeoutMs?: number;
  /** 指数退避起始延迟（毫秒）。 */
  retryBaseMs?: number;
  /** 指数退避封顶延迟（毫秒）。 */
  retryMaxMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_BASE_MS = 1;
const DEFAULT_RETRY_MAX_MS = 16;

/** 锁超时错误，code 固定为 E_LOCK_TIMEOUT。 */
export class LockTimeoutError extends Error {
  readonly code = ERROR_CODES.E_LOCK_TIMEOUT;

  constructor(message = `lock acquisition timed out`) {
    super(message);
    this.name = 'LockTimeoutError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 在指数退避基础上加入 0..base 的抖动，避免等待方同步碰撞。 */
function jitter(baseMs: number): number {
  return Math.floor(Math.random() * Math.max(1, baseMs));
}

/** pid 是否存活：kill(pid, 0) 不抛错或抛 EPERM 均视为存活。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 判断锁文件是否 stale（持有者已死或文件无法解析出存活 pid）。 */
async function isStale(lockfile: string): Promise<boolean> {
  try {
    const raw = await readFile(lockfile, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) {
      // 文件内容不完整/损坏，交给超时而非误回收。
      return false;
    }
    return !pidAlive(parsed.pid);
  } catch {
    // 文件不存在（已被释放）或读取失败：不判定 stale，走重试。
    return false;
  }
}

async function tryAcquire(lockfile: string): Promise<FileHandle | null> {
  try {
    const fd = await open(lockfile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await fd.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
    return fd;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
}

/**
 * 在建议锁保护下执行 fn（同步或异步），锁随 finally 释放。
 * 超时抛 LockTimeoutError（code = E_LOCK_TIMEOUT）。
 */
export async function withLock<T>(
  lockfile: string,
  fn: () => T | Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;

  const start = Date.now();
  let delay = retryBaseMs;
  let fd: FileHandle | null = null;

  while (fd === null) {
    fd = await tryAcquire(lockfile);
    if (fd !== null) break;

    if (await isStale(lockfile)) {
      await unlink(lockfile).catch(() => undefined);
      continue; // 立即重试，避免无谓等待。
    }

    if (Date.now() - start >= timeoutMs) {
      throw new LockTimeoutError(
        `lock acquisition timed out after ${timeoutMs}ms on ${lockfile}`,
      );
    }

    await sleep(delay + jitter(retryBaseMs));
    delay = Math.min(delay * 2, retryMaxMs);
  }

  try {
    return await fn();
  } finally {
    await fd.close().catch(() => undefined);
    await unlink(lockfile).catch(() => undefined);
  }
}
