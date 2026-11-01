import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockTimeoutError, withLock } from '../src/storage/lock';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'amm-lock-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('lock', () => {
  it('serializes concurrent critical sections with no lost updates', async () => {
    const lockfile = join(await tempDir(), '.test.lock');
    const state = { value: 0 };

    const run = () =>
      withLock(lockfile, async () => {
        const v = state.value;
        await sleep(5);
        state.value = v + 1;
      });

    await Promise.all(Array.from({ length: 10 }, run));
    expect(state.value).toBe(10);
  });

  it('times out and throws E_LOCK_TIMEOUT when lock is held', async () => {
    const dir = await tempDir();
    const lockfile = join(dir, '.test2.lock');
    // 用存活 pid 持有锁（模拟另一进程持锁）。
    await writeFile(lockfile, JSON.stringify({ pid: process.pid }));

    await expect(
      withLock(lockfile, async () => 'unreachable', { timeoutMs: 60 }),
    ).rejects.toBeInstanceOf(LockTimeoutError);

    try {
      await withLock(lockfile, async () => 'unreachable', { timeoutMs: 60 });
    } catch (err) {
      expect((err as LockTimeoutError).code).toBe('E_LOCK_TIMEOUT');
    }
    await unlink(lockfile);
  });

  it('reclaims a stale lock held by a dead pid', async () => {
    const lockfile = join(await tempDir(), '.test3.lock');
    // 2147483647 超出常规 pid 范围，几乎必然不可达。
    await writeFile(lockfile, JSON.stringify({ pid: 2147483647 }));

    await expect(
      withLock(lockfile, async () => 42, { timeoutMs: 500 }),
    ).resolves.toBe(42);
  });

  it('runs the critical section and releases the lock', async () => {
    const lockfile = join(await tempDir(), '.test4.lock');
    const result = await withLock(lockfile, async () => 'done');
    expect(result).toBe('done');
  });
});
