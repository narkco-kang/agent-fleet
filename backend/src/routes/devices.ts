import type { FastifyInstance } from 'fastify';
import type { AgentType } from '@agentmesh/shared';
import { deviceRegistry } from '../services/deviceRegistry.js';
import {
  deleteDevice,
  getDevice,
  listDevices,
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
      return {
        ...toDeviceSnapshot(
          row,
          entry?.load ?? { cpu: 0, mem: 0 },
          entry?.busyAgents ?? 0,
          teamNameOf(row.team_id),
        ),
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
    return {
      ok: true,
      data: {
        ...toDeviceSnapshot(
          row,
          entry?.load ?? { cpu: 0, mem: 0 },
          entry?.busyAgents ?? 0,
          teamNameOf(row.team_id),
        ),
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
}
