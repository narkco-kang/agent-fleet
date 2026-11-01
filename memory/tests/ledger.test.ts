import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
  const dir = await mkdtemp(join(tmpdir(), 'amm-ledger-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('ledger', () => {
  it('load() initializes a fresh ledger with genesis', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const doc = await ledger.load();

    expect(doc.schema).toBe('amm/v1');
    expect(doc.group).toBe('team-a');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.hash).toBe(GENESIS.hash);
    expect(doc.tip).toEqual({ index: 0, hash: GENESIS.hash });
    expect(doc.genesis.hash).toBe(GENESIS.hash);
  });

  it('appendBlock advances tip correctly', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const b1 = buildBlock([makeChange('c1', 1)], GENESIS, 'dev', 1000);
    const b2 = buildBlock([makeChange('c2', 2)], b1, 'dev', 1001);

    expect(await ledger.appendBlock(b1)).toBe('ok');
    expect(await ledger.appendBlock(b2)).toBe('ok');

    const tip = await ledger.tip();
    expect(tip.index).toBe(2);
    expect(tip.hash).toBe(b2.hash);
    expect((await ledger.load()).blocks).toHaveLength(3);
  });

  it('rejects stale / out-of-order blocks and leaves the ledger unchanged', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const b1 = buildBlock([makeChange('c1', 1)], GENESIS, 'dev', 1000);
    expect(await ledger.appendBlock(b1)).toBe('ok');

    // 重复同 index 块（乱序保护）。
    const dupIndex1 = buildBlock([makeChange('c1b', 2)], GENESIS, 'dev', 1001);
    expect(await ledger.appendBlock(dupIndex1)).toBe('stale');

    // 跳号块。
    const skip = { ...buildBlock([makeChange('c3', 3)], b1, 'dev', 1002), index: 3 };
    expect(await ledger.appendBlock(skip)).toBe('stale');

    expect((await ledger.tip()).index).toBe(1);
    expect((await ledger.load()).blocks).toHaveLength(2);
  });

  it('atomicWrite leaves no temp files and produces valid JSON', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    const doc = await ledger.load();
    await ledger.atomicWrite(doc);

    const entries = await readdir(ledger.dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);

    const raw = await readFile(ledger.path, 'utf8');
    expect(JSON.parse(raw).schema).toBe('amm/v1');
  });

  it('ledger file follows the amm/v1 format contract', async () => {
    const ledger = new LedgerStore(await tempDir(), 'team-a');
    await ledger.appendBlock(buildBlock([makeChange('c1', 1)], GENESIS, 'dev', 1000));
    const raw = await readFile(ledger.path, 'utf8');
    const doc = JSON.parse(raw) as Record<string, unknown>;

    expect(doc.schema).toBe('amm/v1');
    expect(doc.group).toBe('team-a');
    expect(Array.isArray(doc.blocks)).toBe(true);
    expect(doc.tip).toBeTruthy();
    expect(doc.genesis).toBeTruthy();
    expect(doc.updatedAt).toBeTruthy();
  });
});
