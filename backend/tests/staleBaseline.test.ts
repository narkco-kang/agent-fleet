import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDb, initDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { createAsset, updateAsset } from '../src/db/repo/assets.js';
import { createDelivery, staleDeliveries } from '../src/db/repo/assetDeliveries.js';

/**
 * 陈旧工作区防护（stale-base）：设备已分发资产版本落后于最新基线 → 标记陈旧，提示重新分发。
 */
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfleet-stale-'));
  config.dbPath = path.join(tmpDir, 'test.db');
  initDatabase();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec(`DELETE FROM assets; DELETE FROM asset_deliveries;`);
});

function deliver(assetId: string, assetVersion: number, deviceId: string): void {
  createDelivery({
    deliveryId: `dl-${assetId}-${deviceId}-${assetVersion}`,
    assetId,
    assetVersion,
    deviceId,
    status: 'delivered',
  });
}

describe('陈旧工作区检测（stale-base）', () => {
  it('资产更新后，已分发旧版本的设备被标记陈旧', () => {
    createAsset({ assetId: 'a1', kind: 'skill', name: '登录模板', content: 'v1' });
    deliver('a1', 1, 'dev-a');

    updateAsset('a1', { content: 'v2' }); // version → 2

    const stale = staleDeliveries();
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      assetId: 'a1',
      deviceId: 'dev-a',
      deliveredVersion: 1,
      assetVersion: 2,
    });
  });

  it('已分发最新版本 → 不陈旧', () => {
    createAsset({ assetId: 'a2', kind: 'rule', name: '代码规范', content: 'v1' });
    deliver('a2', 1, 'dev-a');

    expect(staleDeliveries()).toHaveLength(0);
  });

  it('未 delivered（pending）的分发不参与陈旧检测', () => {
    createAsset({ assetId: 'a3', kind: 'skill', name: '部署脚本', content: 'v1' });
    createDelivery({ deliveryId: 'dl-p', assetId: 'a3', assetVersion: 1, deviceId: 'dev-a', status: 'pending' });
    updateAsset('a3', { content: 'v2' });

    expect(staleDeliveries()).toHaveLength(0); // pending 不算已分发
  });

  it('已删除资产不出现在陈旧清单', () => {
    createAsset({ assetId: 'a4', kind: 'skill', name: '已删资产', content: 'v1' });
    deliver('a4', 1, 'dev-a');
    getDb().prepare(`DELETE FROM assets WHERE asset_id = 'a4'`).run();

    expect(staleDeliveries()).toHaveLength(0);
  });

  it('同一设备同资产取最新分发版本比对', () => {
    createAsset({ assetId: 'a5', kind: 'skill', name: '重发资产', content: 'v1' });
    deliver('a5', 1, 'dev-a');
    updateAsset('a5', { content: 'v2' });
    deliver('a5', 2, 'dev-a'); // 重新分发到 v2
    updateAsset('a5', { content: 'v3' }); // 又更新到 v3

    const stale = staleDeliveries();
    expect(stale).toHaveLength(1);
    expect(stale[0]?.deliveredVersion).toBe(2); // 取最新分发 v2，仍落后于 v3
    expect(stale[0]?.assetVersion).toBe(3);
  });
});
