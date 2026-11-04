import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Team } from '@agentfleet/shared';
import { useDeviceStore, type DeviceRecord } from '../../store/deviceStore';
import { http } from '../../api/http';
import { Card } from '../common/Card';
import { StatusBadge } from '../common/StatusBadge';
import { AgentIcon } from '../common/AgentIcon';

/**
 * 设备卡片（04 §6.3）：名称 + 在线圆点 + agent 图标行 + 负载条 + 团队绑定。
 */
export function DeviceCard({
  device,
  teams = [],
}: {
  device: DeviceRecord;
  teams?: Team[];
}): ReactNode {
  const navigate = useNavigate();
  const upsertDevice = useDeviceStore((s) => s.upsertDevice);
  const load = Math.round(device.load.cpu * 100);

  const bindTeam = async (teamId: string): Promise<void> => {
    try {
      const res = await http.setDeviceTeam(device.deviceId, teamId || null);
      upsertDevice({
        ...device,
        teamId: res.data.teamId,
        teamName: res.data.teamName,
      });
    } catch {
      // 演示模式 / 后端离线：静默失败，不打断浏览
    }
  };

  return (
    <Card className="cursor-pointer p-4 transition-shadow hover:shadow-md" onClick={() => navigate(`/devices/${device.deviceId}`)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: device.status === 'online' ? '#10B981' : device.status === 'busy' ? '#F59E0B' : '#94A3B8' }}
          />
          <span className="font-semibold text-[var(--text-strong)]">{device.name}</span>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <div className="mt-2 truncate text-xs text-[var(--text-muted)]">ID: {device.deviceId}</div>

      <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="shrink-0 text-xs text-[var(--text-muted)]">团队</span>
        {teams.length > 0 ? (
          <select
            className="min-w-0 flex-1 truncate rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--text-strong)]"
            value={device.teamId ?? ''}
            onChange={(e) => void bindTeam(e.target.value)}
          >
            <option value="">未绑定</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate text-xs text-[var(--text-muted)]">{device.teamName ?? '未绑定'}</span>
        )}
      </div>

      <div className="mt-3 flex gap-1.5">
        {device.agents.length === 0 ? (
          <span className="text-xs text-[var(--text-muted)]">暂无 agent</span>
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
        <div className="mb-1 flex justify-between text-xs text-[var(--text-muted)]">
          <span>负载</span>
          <span>{device.status === 'offline' ? '— 离线' : `${load}%`}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-subtle)]">
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
