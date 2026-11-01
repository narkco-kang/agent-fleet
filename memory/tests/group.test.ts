import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlock, GENESIS } from '../src/core/block';
import { LedgerStore } from '../src/storage/ledger';
import type { MemoryChange } from '../src/types/block';

function makeChange(id: string, rev: number): MemoryChange {
  return {
    id,
    op: 'add_node',
    target: `node-${id}`,
    by: 'tester',
    at: '2026-01-01T00:00:00+00:00',
    rev,
    note: '',
  };
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'amm-group-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('双层账本（group 分账本）', () => {
  it('不同 group 各自独立账本文件，互不覆盖', async () => {
    const dir = await tempDir();
    const local = new LedgerStore(dir, 'local');
    const team = new LedgerStore(dir, 'team');

    // 本地账本追加 2 块，团队账本追加 3 块
    let tip = GENESIS;
    const b1 = buildBlock([makeChange('l1', 1)], tip, 'device-a');
    await local.appendBlock(b1);
    const b2 = buildBlock([makeChange('l2', 2)], b1, 'device-a');
    await local.appendBlock(b2);

    let ttip = GENESIS;
    const t1 = buildBlock([makeChange('t1', 1)], ttip, 'leader');
    await team.appendBlock(t1);
    const t2 = buildBlock([makeChange('t2', 2)], t1, 'leader');
    await team.appendBlock(t2);
    const t3 = buildBlock([makeChange('t3', 3)], t2, 'leader');
    await team.appendBlock(t3);

    // 各自 tip 独立
    const localTip = await local.tip();
    const teamTip = await team.tip();
    expect(localTip.index).toBe(2);
    expect(localTip.hash).toBe(b2.hash);
    expect(teamTip.index).toBe(3);
    expect(teamTip.hash).toBe(t3.hash);

    // 生成两个独立文件
    const files = (await readdir(dir)).filter((f) => f.startsWith('ledger.'));
    expect(files.sort()).toEqual(['ledger.local.json', 'ledger.team.json']);
  });

  it('group 含非法字符被安全替换，不路径穿越', async () => {
    const dir = await tempDir();
    const store = new LedgerStore(dir, '../evil/group');
    const doc = await store.load();
    expect(doc.group).toBe('../evil/group'); // 逻辑 group 名保留
    // 文件落在 dir 内（无路径穿越）：路径分隔符 / 已被替换为 _
    const files = (await readdir(dir)).filter((f) => f.startsWith('ledger.'));
    expect(files.length).toBe(1);
    expect(files[0]).not.toContain('/');
    // store.path 是 dir 的直接子路径，不存在穿越
    expect(store.path.startsWith(dir)).toBe(true);
  });
});
