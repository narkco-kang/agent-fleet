import { useEffect, useState } from 'react';
import type { Team } from '@agentfleet/shared';
import { DeviceGrid } from '../components/device/DeviceGrid';
import { http } from '../api/http';

/**
 * 设备管理页（04 §6.3）：设备卡片 + 按设备绑定团队（团队模式路由）。
 */
export default function DevicesPage(): JSX.Element {
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    http
      .getTeams()
      .then((res) => setTeams(res.data))
      .catch(() => setTeams([]));
  }, []);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">设备管理</h1>
        <span className="text-xs text-[var(--text-muted)]">每台设备可绑定不同团队（如 A=软件开发、B=内容专家）</span>
      </div>
      <DeviceGrid teams={teams} />
    </div>
  );
}
