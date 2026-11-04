/**
 * 单文件账本存储：ledger.<group>.json + 原子替换 + 建议锁。
 *
 * 每个 group 一个独立账本文件，支持「双层账本」：
 *   - 设备本地账本（group="local" 或每项目一个本地 group）：只本设备记账
 *   - 团队共享账本（group="team" 或每团队一个 group）：参与跨设备同步 + 共识
 * 文件格式（schema="amm/v1"，与 amg 的 "amg/v1" 区分）：
 *   { schema, group, genesis, blocks[], tip, updatedAt }
 * 原子替换：temp + fsync + rename，崩溃只会留旧文件或新文件，无半写。
 */
import { randomBytes } from 'node:crypto';
import { open, mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GENESIS } from '../core/block';
import type { Block } from '../types/block';
import { ERROR_CODES } from '../types';
import { withLock } from './lock';

/** 链头冗余快照。 */
export interface LedgerTip {
  index: number;
  hash: string;
}

/** ledger.json 文档结构。 */
export interface LedgerDoc {
  schema: 'amm/v1';
  group: string;
  genesis: { hash: string; created_at: string };
  blocks: Block[];
  tip: LedgerTip;
  updatedAt: string;
}

/** appendBlock 返回状态：ok 已追加，stale 序号不连续（交 catchup）。 */
export type AppendStatus = 'ok' | 'stale';

/**
 * 单文件账本存储：load / appendBlock / atomicWrite / tip。
 * 语义图仍由 amg 维护，账本只存「区块 + change」。
 */
export class LedgerStore {
  readonly path: string;
  readonly lockfile: string;

  constructor(
    readonly dir: string,
    readonly group: string = 'default',
  ) {
    // group 进文件名，让每个 group 拥有独立账本（双层账本的关键）。
    // 仅允许安全字符，避免路径穿越。
    const safeGroup = group.replace(/[^a-zA-Z0-9._-]/g, '_');
    this.path = join(dir, `ledger.${safeGroup}.json`);
    this.lockfile = join(dir, `.ledger.${safeGroup}.lock`);
  }

  /** 构造一个全新的账本文档（仅含 genesis）。 */
  private freshDoc(): LedgerDoc {
    const now = new Date().toISOString();
    return {
      schema: 'amm/v1',
      group: this.group,
      genesis: { hash: GENESIS.hash, created_at: now },
      blocks: [structuredClone(GENESIS)],
      tip: { index: GENESIS.index, hash: GENESIS.hash },
      updatedAt: now,
    };
  }

  /** 读取账本（无锁）；不存在则初始化并落盘。 */
  private async readDoc(): Promise<LedgerDoc> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return JSON.parse(raw) as LedgerDoc;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const doc = this.freshDoc();
        await this.atomicWrite(doc);
        return doc;
      }
      throw err;
    }
  }

  /** 加载账本文档。 */
  async load(): Promise<LedgerDoc> {
    return this.readDoc();
  }

  /** 当前链头块。 */
  async tip(): Promise<Block> {
    const doc = await this.readDoc();
    const last = doc.blocks[doc.blocks.length - 1];
    if (!last) throw new Error(`${ERROR_CODES.E_BAD_GENESIS}: ledger has no blocks`);
    return structuredClone(last);
  }

  /**
   * 追加区块：仅接受 index == tip.index + 1（幂等/乱序保护）。
   * 返回 'ok' 或 'stale'（stale 交 catchup 处理，不写盘）。
   */
  async appendBlock(block: Block): Promise<AppendStatus> {
    return withLock(this.lockfile, async (): Promise<AppendStatus> => {
      const doc = await this.readDoc();
      const tipIndex = doc.blocks.length
        ? doc.blocks[doc.blocks.length - 1]!.index
        : -1;

      if (block.index !== tipIndex + 1) {
        return 'stale';
      }

      doc.blocks.push(structuredClone(block));
      doc.tip = { index: block.index, hash: block.hash };
      doc.updatedAt = new Date().toISOString();
      await this.atomicWrite(doc);
      return 'ok';
    });
  }

  /**
   * 批量追加连续区块（断线补同步用）：一次锁 + 一次落盘。
   * 与 appendBlock 语义一致——只接受 index 连续的块，遇到不连续即停止；
   * 相比逐块 appendBlock（每次全量重写文件，O(n²)），批量写只需一次 JSON 序列化 + fsync。
   * 返回实际追加的块数。
   */
  async appendBlocks(blocks: Block[]): Promise<number> {
    return withLock(this.lockfile, async (): Promise<number> => {
      const doc = await this.readDoc();
      let tipIndex = doc.blocks.length
        ? doc.blocks[doc.blocks.length - 1]!.index
        : -1;

      let added = 0;
      for (const block of blocks) {
        if (block.index !== tipIndex + 1) break;
        doc.blocks.push(structuredClone(block));
        tipIndex = block.index;
        added += 1;
      }

      if (added === 0) return 0;
      const last = doc.blocks[doc.blocks.length - 1]!;
      doc.tip = { index: last.index, hash: last.hash };
      doc.updatedAt = new Date().toISOString();
      await this.atomicWrite(doc);
      return added;
    });
  }

  /** 原子写：写临时文件 + fsync + rename 原子替换。 */
  async atomicWrite(doc: LedgerDoc): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });

    const tmp = join(dir, `.ledger.${randomBytes(6).toString('hex')}.tmp`);
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(JSON.stringify(doc, null, 2), 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, this.path);
  }
}
