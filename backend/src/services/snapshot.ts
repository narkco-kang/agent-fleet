import type {
  AgentSnapshot,
  DashboardPatch,
  DashboardSnapshot,
  DeviceSnapshot,
  TaskEvent,
  TaskResult,
  TaskStatus,
} from '@agentmesh/shared';
import { SNAPSHOT_TASK_WINDOW } from '@agentmesh/shared';
import { deviceRegistry } from './deviceRegistry.js';
import { getDevice, listDevices, toDeviceSnapshot } from '../db/repo/devices.js';
import { listAgents, toAgentSnapshot } from '../db/repo/agents.js';
import { listTasks, toTaskSnapshot } from '../db/repo/tasks.js';
import { getTeam } from '../db/repo/teams.js';
import { getBusyCount } from './scheduler.js';

/** 设备绑定团队名（未绑定返回 null） */
function teamNameOf(teamId: string | null): string | null {
  if (!teamId) return null;
  return getTeam(teamId)?.name ?? null;
}

/**
 * 看板快照装配器：把 DB + 注册表组装为 dashboard.snapshot / dashboard.patch。
 */
export function buildSnapshot(): DashboardSnapshot {
  const devices: DeviceSnapshot[] = listDevices().map((row) => {
    const entry = deviceRegistry.get(row.device_id);
    return toDeviceSnapshot(
      row,
      entry?.load ?? { cpu: 0, mem: 0 },
      entry?.busyAgents ?? getBusyCount(row.device_id),
      teamNameOf(row.team_id),
    );
  });

  const agents: AgentSnapshot[] = listAgents().map(toAgentSnapshot);

  const tasks = listTasks({}, SNAPSHOT_TASK_WINDOW).map(toTaskSnapshot);

  return {
    kind: 'snapshot',
    devices,
    agents,
    tasks,
    relayOnline: false,
    ts: Date.now(),
  };
}

/** 构造 patch 信封（单实体变化） */
export function makePatch(
  changes: Omit<DashboardPatch, 'kind' | 'ts'>,
): DashboardPatch {
  return { kind: 'patch', ...changes, ts: Date.now() };
}

/** 单设备 patch（在线/离线/负载实时刷新） */
export function buildDevicePatch(deviceId: string): DashboardPatch {
  const row = getDevice(deviceId);
  if (!row) return makePatch({});
  const entry = deviceRegistry.get(deviceId);
  const snapshot = toDeviceSnapshot(
    row,
    entry?.load ?? { cpu: 0, mem: 0 },
    entry?.busyAgents ?? getBusyCount(deviceId),
    teamNameOf(row.team_id),
  );
  return makePatch({ devices: [snapshot] });
}

/** 任务状态 patch（任务列表与神经图实时刷新） */
export function taskStatusPatch(taskId: string, status: TaskStatus): DashboardPatch {
  return makePatch({
    tasks: [{ taskId, status } as NonNullable<DashboardPatch['tasks']>[number]],
  });
}

/** 消息事件 patch（时间线 + 神经图流动光点） */
export function taskEventPatch(event: TaskEvent): DashboardPatch {
  return makePatch({ events: [event] });
}
