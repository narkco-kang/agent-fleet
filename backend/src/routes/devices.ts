import type { FastifyInstance } from 'fastify';
import type { AgentType } from '@agentfleet/shared';
import { MESSAGE_TYPES } from '@agentfleet/shared';
import { deviceRegistry } from '../services/deviceRegistry.js';
import { sendToDevice } from '../transport/wsServer.js';
import {
  deleteDevice,
  getDevice,
  listDevices,
  listDevicesByGroup,
  setDeviceGroup,
  setDeviceTeam,
  setDeviceToken,
  setPrimaryAgent,
  setPrimaryAgents,
  toDeviceSnapshot,
} from '../db/repo/devices.js';
import { listAgentsByDevice, toAgentSnapshot } from '../db/repo/agents.js';
import { getTeam } from '../db/repo/teams.js';
import { createPairing, getPendingPair, verifyPairing } from '../security/pairing.js';
import { issueToken } from '../security/auth.js';
import { roleTeamNameOf } from '../services/snapshot.js';

/** 团队名（未绑定返回 null） */
function teamNameOf(teamId: string | null): string | null {
  return teamId ? getTeam(teamId)?.name ?? null : null;
}

/**
 * 设备 REST 路由：列表 / 详情 / 配对 / 删除。
 */
export function registerDeviceRoutes(app: FastifyInstance): void {
  /** 设备列表（含在线状态、agent 能力） */
  app.get('/api/devices', async () => {
    const devices = listDevices().map((row) => {
      const entry = deviceRegistry.get(row.device_id);
      const agents = listAgentsByDevice(row.device_id).map(toAgentSnapshot);
      const snapshot = toDeviceSnapshot(
        row,
        entry?.load ?? { cpu: 0, mem: 0 },
        entry?.busyAgents ?? 0,
        teamNameOf(row.team_id),
        roleTeamNameOf(row.role_team_id),
      );
      return {
        ...snapshot,
        status: deviceRegistry.isOnline(row.device_id) ? snapshot.status : 'offline',
        agents,
      };
    });
    return { ok: true, data: devices };
  });

  /** 设备详情 */
  app.get<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const row = getDevice(req.params.id);
    if (!row) {
      return reply.code(404).send({ ok: false, error: 'device_not_found' });
    }
    const entry = deviceRegistry.get(row.device_id);
    const agents = listAgentsByDevice(row.device_id).map(toAgentSnapshot);
    const snapshot = toDeviceSnapshot(
      row,
      entry?.load ?? { cpu: 0, mem: 0 },
      entry?.busyAgents ?? 0,
      teamNameOf(row.team_id),
      roleTeamNameOf(row.role_team_id),
    );
    return {
      ok: true,
      data: {
        ...snapshot,
        status: deviceRegistry.isOnline(row.device_id) ? snapshot.status : 'offline',
        agents,
      },
    };
  });

  /** 发起配对：返回配对码 */
  app.post<{ Body: { deviceId: string; name?: string } }>('/api/devices/pair', async (req, reply) => {
    const { deviceId, name } = req.body ?? {};
    if (!deviceId) {
      return reply.code(400).send({ ok: false, error: 'deviceId required' });
    }
    const code = createPairing(deviceId, name ?? deviceId);
    return { ok: true, data: { deviceId, pairingCode: code } };
  });

  /** 查询待配对状态 */
  app.get<{ Params: { id: string } }>('/api/devices/:id/pair', async (req) => {
    const pending = getPendingPair(req.params.id);
    return { ok: true, data: pending ? { pairingCode: pending.code } : null };
  });

  /** 确认配对：校验配对码，签发 token */
  app.post<{ Params: { id: string }; Body: { pairingCode: string } }>(
    '/api/devices/:id/pair',
    async (req, reply) => {
      const name = verifyPairing(req.params.id, req.body?.pairingCode ?? '');
      if (!name) {
        return reply.code(401).send({ ok: false, error: 'invalid_pairing_code' });
      }
      const token = issueToken(req.params.id);
      setDeviceToken(req.params.id, token);
      return { ok: true, data: { deviceId: req.params.id, token, name } };
    },
  );

  /** 删除设备 */
  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    deleteDevice(req.params.id);
    deviceRegistry.remove(req.params.id);
    return { ok: true };
  });

  /** 设置单设备主 AI agent */
  app.put<{ Params: { id: string }; Body: { agentType?: string | null } }>(
    '/api/devices/:id/primary-agent',
    async (req, reply) => {
      const row = getDevice(req.params.id);
      if (!row) {
        return reply.code(404).send({ ok: false, error: 'device_not_found' });
      }
      const { agentType = null } = req.body ?? {};
      setPrimaryAgent(req.params.id, (agentType as AgentType) ?? null);
      return { ok: true, data: { deviceId: req.params.id, primaryAgentType: agentType } };
    },
  );

  /** 设置设备绑定的团队（null = 解绑） */
  app.put<{ Params: { id: string }; Body: { teamId?: string | null } }>(
    '/api/devices/:id/team',
    async (req, reply) => {
      const row = getDevice(req.params.id);
      if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
      const { teamId = null } = req.body ?? {};
      if (teamId && !getTeam(teamId)) {
        return reply.code(404).send({ ok: false, error: 'team_not_found' });
      }
      setDeviceTeam(req.params.id, teamId ?? null);
      return {
        ok: true,
        data: {
          deviceId: req.params.id,
          teamId: teamId ?? null,
          teamName: teamId ? getTeam(teamId)?.name ?? null : null,
        },
      };
    },
  );

  /** 设置设备分组标签（group 为空字符串 = 清除分组，群组感知） */
  app.put<{ Params: { id: string }; Body: { group?: string } }>(
    '/api/devices/:id/group',
    async (req, reply) => {
      const row = getDevice(req.params.id);
      if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
      const group = (req.body?.group ?? '').trim();
      setDeviceGroup(req.params.id, group);
      return { ok: true, data: { deviceId: req.params.id, groupName: group || null } };
    },
  );

  /** 列出所有设备分组（群组感知，供新建任务选分组） */
  app.get('/api/devices/groups', async () => {
    const rows = listDevices();
    const groups = new Map<string, number>();
    for (const r of rows) {
      const g = (r.group_name ?? '').trim();
      if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    return {
      ok: true,
      data: Array.from(groups.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  /** 批量设置主 AI agent */
  app.post<{ Body: { deviceIds?: string[]; agentType?: string | null } }>(
    '/api/devices/primary-agent',
    async (req, reply) => {
      const { deviceIds = [], agentType = null } = req.body ?? {};
      if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
        return reply.code(400).send({ ok: false, error: 'deviceIds required' });
      }
      const changed = setPrimaryAgents(deviceIds, (agentType as AgentType) ?? null);
      return { ok: true, data: { changed, primaryAgentType: agentType } };
    },
  );

  /** 打开平台应用（登录激活）：向在线设备下发 device.platform_open */
  app.post<{ Params: { id: string; agentType: string } }>(
    '/api/devices/:id/platforms/:agentType/open',
    async (req, reply) => {
      const { id, agentType } = req.params;
      const row = getDevice(id);
      if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
      if (!deviceRegistry.isOnline(id)) {
        return reply.code(409).send({ ok: false, error: 'device_offline' });
      }
      const sent = sendToDevice(id, {
        v: 1,
        type: MESSAGE_TYPES.DEVICE_PLATFORM_OPEN,
        id: `popen-${Date.now()}`,
        ts: Date.now(),
        from: 'coordinator',
        to: id,
        payload: { deviceId: id, agentType },
      });
      if (!sent) return reply.code(409).send({ ok: false, error: 'device_not_reachable' });
      return { ok: true, data: { dispatched: true, deviceId: id, agentType } };
    },
  );

  /** 发起登录授权（看板授权中心）：向在线设备下发 device.login_request，
   *  设备执行 platform device-auth，回传 URL+code 经看板展示给用户完成浏览器授权。 */
  app.post<{ Params: { id: string; agentType: string } }>(
    '/api/devices/:id/platforms/:agentType/login',
    async (req, reply) => {
      const { id, agentType } = req.params;
      const row = getDevice(id);
      if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
      if (!deviceRegistry.isOnline(id)) {
        return reply.code(409).send({ ok: false, error: 'device_offline' });
      }
      const sent = sendToDevice(id, {
        v: 1,
        type: MESSAGE_TYPES.DEVICE_LOGIN_REQUEST,
        id: `loginreq-${Date.now()}`,
        ts: Date.now(),
        from: 'coordinator',
        to: id,
        payload: { deviceId: id, agentType },
      });
      if (!sent) return reply.code(409).send({ ok: false, error: 'device_not_reachable' });
      return { ok: true, data: { dispatched: true, deviceId: id, agentType } };
    },
  );

  /** 一键配置模型（免登录激活）：向设备下发免费源模型配置（默认 kilo，原生 Responses API 免 key），
   *  设备写入 codex/claude 配置文件，免登录走免费源跑任务。 */
  app.post<{
    Params: { id: string; agentType: string };
    Body: { baseUrl?: string; model?: string; apiKey?: string };
  }>('/api/devices/:id/platforms/:agentType/model-config', async (req, reply) => {
    const { id, agentType } = req.params;
    const row = getDevice(id);
    if (!row) return reply.code(404).send({ ok: false, error: 'device_not_found' });
    if (!deviceRegistry.isOnline(id)) {
      return reply.code(409).send({ ok: false, error: 'device_offline' });
    }
    // 默认：kilo 免费源（原生 Responses API、免 key），codex 直连即可免登录
    const baseUrl = req.body?.baseUrl ?? 'https://api.kilo.ai/api/gateway/v1';
    const model = req.body?.model ?? 'kilo-auto/free';
    const apiKey = req.body?.apiKey ?? '';
    const sent = sendToDevice(id, {
      v: 1,
      type: MESSAGE_TYPES.DEVICE_MODEL_CONFIG,
      id: `modelcfg-${Date.now()}`,
      ts: Date.now(),
      from: 'coordinator',
      to: id,
      payload: { deviceId: id, agentType, baseUrl, model, apiKey },
    });
    if (!sent) return reply.code(409).send({ ok: false, error: 'device_not_reachable' });
    return { ok: true, data: { dispatched: true, deviceId: id, agentType, baseUrl, model } };
  });
}
