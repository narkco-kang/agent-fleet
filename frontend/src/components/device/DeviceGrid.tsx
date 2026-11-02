import type { ReactNode } from 'react';
import type { Team } from '@agentfleet/shared';
import { useDeviceStore, type DeviceRecord } from '../../store/deviceStore';
import { DeviceCard } from './DeviceCard';

/**
 * 设备卡片网格（响应式：1/2/3 列）。
 */
export function DeviceGrid({ teams = [] }: { teams?: Team[] }): ReactNode {
  const devices = useDeviceStore((s) => s.devices);

  if (devices.length === 0) {
    return <div className="py-16 text-center text-[#94A3B8]">暂无设备，请启动设备守护进程或查看演示数据</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {devices.map((d: DeviceRecord) => (
        <DeviceCard key={d.deviceId} device={d} teams={teams} />
      ))}
    </div>
  );
}
