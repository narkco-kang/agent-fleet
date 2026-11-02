import { getDb } from '../database.js';
import type { AgentType, DeviceSnapshot, DeviceStatus } from '@agentfleet/shared';

/** devices 表行结构 */
export interface DeviceRow {
  device_id: string;
  name: string;
  hostname: string;
  os_platform: string;
  os_arch: string;
  daemon_version: string;
  status: DeviceStatus;
  last_heartbeat: number | null;
  lan_addr: string | null;
  relay_online: number;
  token: string;
  owner: string;
  primary_agent_type: AgentType | null;
  team_id: string | null;
  created_at: number;
}

/** 设备 upsert（注册时） */
export function upsertDevice(
  data: {
    deviceId: string;
    name: string;
    hostname: string;
    os: { platform: string; arch: string; release: string };
    version: string;
    token?: string;
    lanAddr?: string;
  },
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO devices
      (device_id, name, hostname, os_platform, os_arch, daemon_version, status, last_heartbeat, lan_addr, token)
     VALUES (@deviceId, @name, @hostname, @platform, @arch, @version, 'online', @now, @lanAddr, @token)
     ON CONFLICT(device_id) DO UPDATE SET
       name = excluded.name,
       hostname = excluded.hostname,
       os_platform = excluded.os_platform,
       os_arch = excluded.os_arch,
       daemon_version = excluded.daemon_version,
       status = 'online',
       last_heartbeat = excluded.last_heartbeat,
       lan_addr = COALESCE(excluded.lan_addr, devices.lan_addr),
       token = CASE WHEN excluded.token = '' THEN devices.token ELSE excluded.token END`,
  ).run({
    deviceId: data.deviceId,
    name: data.name,
    hostname: data.hostname,
    platform: data.os.platform,
    arch: data.os.arch,
    version: data.version,
    token: data.token ?? '',
    lanAddr: data.lanAddr ?? null,
    now: Date.now(),
  });
}

/** 更新心跳时间与状态 */
export function touchHeartbeat(deviceId: string, status: DeviceStatus = 'online'): void {
  getDb()
    .prepare(`UPDATE devices SET last_heartbeat = ?, status = ? WHERE device_id = ?`)
    .run(Date.now(), status, deviceId);
}

/** 更新设备状态 */
export function setDeviceStatus(deviceId: string, status: DeviceStatus): void {
  getDb()
    .prepare(`UPDATE devices SET status = ? WHERE device_id = ?`)
    .run(status, deviceId);
}

/** 更新中继在线标记 */
export function setDeviceRelay(deviceId: string, relayOnline: boolean): void {
  getDb()
    .prepare(`UPDATE devices SET relay_online = ? WHERE device_id = ?`)
    .run(relayOnline ? 1 : 0, deviceId);
}

/** 更新局域网地址 */
export function setDeviceLanAddr(deviceId: string, lanAddr: string): void {
  getDb()
    .prepare(`UPDATE devices SET lan_addr = ? WHERE device_id = ?`)
    .run(lanAddr, deviceId);
}

/** 更新设备 token */
export function setDeviceToken(deviceId: string, token: string): void {
  getDb()
    .prepare(`UPDATE devices SET token = ? WHERE device_id = ?`)
    .run(token, deviceId);
}

/** 设置单设备的主 AI agent（agentType 为 null 表示清除） */
export function setPrimaryAgent(deviceId: string, agentType: AgentType | null): void {
  getDb()
    .prepare(`UPDATE devices SET primary_agent_type = ? WHERE device_id = ?`)
    .run(agentType, deviceId);
}

/** 批量设置主 AI agent */
export function setPrimaryAgents(deviceIds: string[], agentType: AgentType | null): number {
  if (deviceIds.length === 0) return 0;
  const stmt = getDb().prepare(`UPDATE devices SET primary_agent_type = ? WHERE device_id = ?`);
  let n = 0;
  for (const id of deviceIds) {
    n += stmt.run(agentType, id).changes;
  }
  return n;
}

/** 查询所有设备的主 agent 映射（调度路由用） */
export function listPrimaryAgents(): Map<string, AgentType> {
  const rows = getDb()
    .prepare(`SELECT device_id, primary_agent_type FROM devices WHERE primary_agent_type IS NOT NULL`)
    .all() as Array<{ device_id: string; primary_agent_type: AgentType }>;
  return new Map(rows.map((r) => [r.device_id, r.primary_agent_type]));
}

/** 设置设备绑定团队（teamId 为 null 表示解绑） */
export function setDeviceTeam(deviceId: string, teamId: string | null): boolean {
  return getDb().prepare(`UPDATE devices SET team_id = ? WHERE device_id = ?`).run(teamId, deviceId).changes > 0;
}

/** 批量绑定设备到同一团队（teamId 为 null 表示解绑） */
export function setDeviceTeams(deviceIds: string[], teamId: string | null): number {
  if (deviceIds.length === 0) return 0;
  const stmt = getDb().prepare(`UPDATE devices SET team_id = ? WHERE device_id = ?`);
  let n = 0;
  for (const id of deviceIds) n += stmt.run(teamId, id).changes;
  return n;
}

/** 查询全部设备 → 团队映射 */
export function listDeviceTeams(): Map<string, string> {
  const rows = getDb()
    .prepare(`SELECT device_id, team_id FROM devices WHERE team_id IS NOT NULL`)
    .all() as Array<{ device_id: string; team_id: string }>;
  return new Map(rows.map((r) => [r.device_id, r.team_id]));
}

/** 查询某团队绑定的设备 id 列表 */
export function listDevicesByTeam(teamId: string): string[] {
  const rows = getDb()
    .prepare(`SELECT device_id FROM devices WHERE team_id = ? ORDER BY created_at ASC`)
    .all(teamId) as Array<{ device_id: string }>;
  return rows.map((r) => r.device_id);
}

/** 查询设备绑定的团队 id */
export function getDeviceTeam(deviceId: string): string | null {
  const row = getDb()
    .prepare(`SELECT team_id FROM devices WHERE device_id = ?`)
    .get(deviceId) as { team_id: string | null } | undefined;
  return row?.team_id ?? null;
}

/** 按 ID 查询设备 */
export function getDevice(deviceId: string): DeviceRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM devices WHERE device_id = ?`)
    .get(deviceId) as DeviceRow | undefined;
}

/** 全部设备 */
export function listDevices(): DeviceRow[] {
  return getDb()
    .prepare(`SELECT * FROM devices ORDER BY created_at ASC`)
    .all() as DeviceRow[];
}

/** 删除设备 */
export function deleteDevice(deviceId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM devices WHERE device_id = ?`).run(deviceId);
  db.prepare(`DELETE FROM agents WHERE device_id = ?`).run(deviceId);
}

/** 构造看板快照设备节点 */
export function toDeviceSnapshot(
  row: DeviceRow,
  load: { cpu: number; mem: number } = { cpu: 0, mem: 0 },
  busyAgents = 0,
  teamName: string | null = null,
): DeviceSnapshot {
  return {
    deviceId: row.device_id,
    name: row.name,
    hostname: row.hostname,
    osPlatform: row.os_platform,
    osArch: row.os_arch,
    status: row.status,
    lastHeartbeat: row.last_heartbeat,
    lanAddr: row.lan_addr,
    relayOnline: row.relay_online === 1,
    primaryAgentType: row.primary_agent_type,
    teamId: row.team_id ?? null,
    teamName,
    load,
    busyAgents,
  };
}
