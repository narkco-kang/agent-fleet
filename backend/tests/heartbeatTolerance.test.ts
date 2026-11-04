import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 隔离 DB 依赖：心跳容错测试只关心内存注册表，不落库
vi.mock('../src/db/repo/devices.js', () => ({
  setDeviceStatus: vi.fn(),
  setDeviceRelay: vi.fn(),
}));

import { deviceRegistry } from '../src/services/deviceRegistry.js';
import { setDeviceStatus } from '../src/db/repo/devices.js';

/**
 * P1-6 心跳连续 miss 容忍（对齐 Orca MISSED_PROBE_LIMIT=3）：
 * 单次 miss 不判死，连续 3 个超时窗口未收到心跳才判离线，防抖动误杀。
 *
 * 时间线（HEARTBEAT_TIMEOUT_MS=6000，sweep 间隔 1s）：
 *   t=7s 第 1 次 miss → t=8s 第 2 次 → t=9s 第 3 次判死。
 */
describe('心跳连续 miss 容忍（P1-6）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deviceRegistry.stopSweeper();
    for (const e of Array.from(deviceRegistry.all())) deviceRegistry.remove(e.deviceId);
    vi.mocked(setDeviceStatus).mockClear();
  });

  afterEach(() => {
    deviceRegistry.stopSweeper();
    vi.useRealTimers();
  });

  it('单次 miss 不判死，设备仍在线', () => {
    deviceRegistry.register('dev-1', 'Dev 1', 'relay');
    deviceRegistry.startSweeper();

    vi.advanceTimersByTime(7_000); // 超时窗口 + 1 次 miss

    expect(deviceRegistry.isOnline('dev-1')).toBe(true);
    expect(setDeviceStatus).not.toHaveBeenCalledWith('dev-1', 'offline');
  });

  it('连续 3 次 miss 判死', () => {
    deviceRegistry.register('dev-2', 'Dev 2', 'relay');
    deviceRegistry.startSweeper();

    vi.advanceTimersByTime(9_000); // 7s→1、8s→2、9s→3 次 miss

    expect(deviceRegistry.isOnline('dev-2')).toBe(false);
    expect(setDeviceStatus).toHaveBeenCalledWith('dev-2', 'offline');
  });

  it('收到心跳即归零，容错窗口重开', () => {
    deviceRegistry.register('dev-3', 'Dev 3', 'relay');
    deviceRegistry.startSweeper();

    vi.advanceTimersByTime(8_000); // 已累计 2 次 miss，仍未判死
    expect(deviceRegistry.isOnline('dev-3')).toBe(true);

    deviceRegistry.heartbeat('dev-3', { cpu: 0, mem: 0 }, 0); // 心跳归零
    vi.advanceTimersByTime(8_000); // 重新累计 2 次，仍未达 3

    expect(deviceRegistry.isOnline('dev-3')).toBe(true);
    expect(setDeviceStatus).not.toHaveBeenCalledWith('dev-3', 'offline');
  });
});
