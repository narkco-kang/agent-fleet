import type { AgentSnapshot, AgentType, DeviceSnapshot } from '@agentmesh/shared';
import { AgentIcon } from '../common/AgentIcon';

/**
 * 设备 + agent 平台列表：选择「设备 + 平台」以编辑其网关模型绑定。
 */
export type DeviceWithAgents = DeviceSnapshot & { agents: AgentSnapshot[] };

export interface DeviceAgentSelection {
  deviceId: string;
  agentType: AgentType;
}

export function DevicePlatformList({
  devices,
  selected,
  onSelect,
}: {
  devices: DeviceWithAgents[];
  selected: DeviceAgentSelection | null;
  onSelect: (sel: DeviceAgentSelection) => void;
}): JSX.Element {
  return (
    <div className="overflow-auto">
      {devices.length === 0 && (
        <div className="p-6 text-center text-sm text-[#94A3B8]">暂无在线/离线设备</div>
      )}
      {devices.map((d) => (
        <div key={d.deviceId} className="border-b border-[#E2E8F0] py-2">
          <div className="px-3 py-1 text-xs font-semibold text-[#0F172A]">
            {d.name} <span className="ml-1 font-normal text-[#94A3B8]">{d.deviceId}</span>
          </div>
          {d.agents.length === 0 ? (
            <div className="px-3 pb-1 text-xs text-[#94A3B8]">未安装 agent 平台</div>
          ) : (
            d.agents.map((a) => {
              const active = selected?.deviceId === d.deviceId && selected.agentType === a.agentType;
              return (
                <button
                  key={`${d.deviceId}:${a.agentType}`}
                  onClick={() => onSelect({ deviceId: d.deviceId, agentType: a.agentType })}
                  className={`mx-2 my-1 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    active ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'text-[#334155] hover:bg-[#F8FAFC]'
                  }`}
                >
                  <AgentIcon agentType={a.agentType} size={22} />
                  <span>{a.displayName}</span>
                  <span className="ml-auto text-xs text-[#94A3B8]">{a.agentType}</span>
                </button>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}
