import { DeviceGrid } from '../components/device/DeviceGrid';

/**
 * 设备管理页（04 §6.3）。
 */
export default function DevicesPage(): JSX.Element {
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#0F172A]">设备管理</h1>
      </div>
      <DeviceGrid />
    </div>
  );
}
