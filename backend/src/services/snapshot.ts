import type {
  AgentSnapshot,
  DashboardPatch,
  DashboardSnapshot,
  DeviceSnapshot,
  TaskEvent,
  TaskResult,
  TaskStatus,
} from '@agentfleet/shared';
import { SNAPSHOT_TASK_WINDOW } from '@agentfleet/shared';
import { deviceRegistry } from './deviceRegistry.js';
import { getDevice, listDevices, toDeviceSnapshot } from '../db/repo/devices.js';
import { listAgents, toAgentSnapshot } from '../db/repo/agents.js';
import { getTask, listTasks, toTaskSnapshot } from '../db/repo/tasks.js';
import { getTeam } from '../db/repo/teams.js';
import { getRoleTeam } from '../db/repo/roleTeams.js';
import { getBusyCount } from './scheduler.js';

/** 设备绑定团队名（未绑定返回 null） */
function teamNameOf(teamId: string | null): string | null {
  if (!teamId) return null;
  return getTeam(teamId)?.name ?? null;
}

/** 设备绑定蜂群角色团队名（未绑定返回 null） */
export function roleTeamNameOf(roleTeamId: string | null): string | null {
  if (!roleTeamId) return null;
  return getRoleTeam(roleTeamId)?.name ?? null;
}

/**
 * 看板快照装配器：把 DB + 注册表组装为 dashboard.snapshot / dashboard.patch。
 */
export function buildSnapshot(): DashboardSnapshot {
  const devices: DeviceSnapshot[] = listDevices().map((row) => {
    const entry = deviceRegistry.get(row.device_id);
    const snapshot = toDeviceSnapshot(
      row,
      entry?.load ?? { cpu: 0, mem: 0 },
      entry?.busyAgents ?? getBusyCount(row.device_id),
      teamNameOf(row.team_id),
      roleTeamNameOf(row.role_team_id),
    );
    // 与 REST /api/devices 一致：status 以内存注册表在线态为准（DB 静态列可能残留 relay 断线未清的 online）
    return { ...snapshot, status: deviceRegistry.isOnline(row.device_id) ? snapshot.status : 'offline' };
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
    roleTeamNameOf(row.role_team_id),
  );
  const device = { ...snapshot, status: deviceRegistry.isOnline(deviceId) ? snapshot.status : 'offline' };
  return makePatch({ devices: [device] });
}

/**
 * 任务状态 patch（任务列表与神经图实时刷新）。
 * 返回完整 task 快照（含 prompt 等全字段）——前端 upsert 时若拿到部分对象
 * （缺 prompt）会在任务不存在时插入「幽灵任务」，导致详情页 prompt.slice 崩溃。
 */
export function taskStatusPatch(taskId: string, status: TaskStatus): DashboardPatch {
  const row = getTask(taskId);
  if (row) return makePatch({ tasks: [toTaskSnapshot(row)] });
  return makePatch({
    tasks: [{ taskId, status } as NonNullable<DashboardPatch['tasks']>[number]],
  });
}

/** 消息事件 patch（时间线 + 神经图流动光点） */
export function taskEventPatch(event: TaskEvent): DashboardPatch {
  return makePatch({ events: [event] });
}
