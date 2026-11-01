import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DeviceRecord } from '../../store/deviceStore';
import { Card } from '../common/Card';
import { StatusBadge } from '../common/StatusBadge';
import { AgentIcon } from '../common/AgentIcon';

/**
 * 设备卡片（04 §6.3）：名称 + 在线圆点 + agent 图标行 + 负载条。
 */
export function DeviceCard({ device }: { device: DeviceRecord }): ReactNode {
  const navigate = useNavigate();
  const load = Math.round(device.load.cpu * 100);

  return (
    <Card className="cursor-pointer p-4 transition-shadow hover:shadow-md" onClick={() => navigate(`/devices/${device.deviceId}`)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: device.status === 'online' ? '#10B981' : device.status === 'busy' ? '#F59E0B' : '#94A3B8' }}
          />
          <span className="font-semibold text-[#0F172A]">{device.name}</span>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <div className="mt-2 truncate text-xs text-[#64748B]">ID: {device.deviceId}</div>

      <div className="mt-3 flex gap-1.5">
        {device.agents.length === 0 ? (
          <span className="text-xs text-[#94A3B8]">暂无 agent</span>
        ) : (
          device.agents.map((a) => (
            <span
              key={a.agentType}
              className={`relative inline-flex rounded-md ${
                a.agentType === device.primaryAgentType ? 'ring-2 ring-[#4F46E5] ring-offset-1' : ''
              }`}
              title={a.agentType === device.primaryAgentType ? '主 AI agent' : a.agentType}
            >
              {a.agentType === device.primaryAgentType && (
                <span className="absolute -top-1.5 -right-1.5 z-10 rounded bg-[#4F46E5] px-1 text-[9px] font-semibold leading-3.5 text-white">
                  主
                </span>
              )}
              <AgentIcon agentType={a.agentType} />
            </span>
          ))
        )}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-[#64748B]">
          <span>负载</span>
          <span>{device.status === 'offline' ? '— 离线' : `${load}%`}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${device.status === 'offline' ? 0 : load}%`,
              background: load > 80 ? '#EF4444' : load > 50 ? '#F59E0B' : '#10B981',
            }}
          />
        </div>
      </div>
    </Card>
  );
}
