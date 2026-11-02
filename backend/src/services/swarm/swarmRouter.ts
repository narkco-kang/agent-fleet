import type { AgentType, SubRole, SwarmRoutingDecision } from '@agentfleet/shared';
import { deviceRegistry } from '../deviceRegistry.js';
import { listAgentsByDevice, type AgentRow } from '../../db/repo/agents.js';
import { getSubRoleBindings, listDevicesByRoleTeam } from '../../db/repo/devices.js';
import { getRoleTeam, getSubRole, listSubRoles } from '../../db/repo/roleTeams.js';
import { buildSystemPrompt } from './personaBuilder.js';

/**
 * 蜂群软绑定三级决策：resolveCandidates({ roleTeamId, subRoleSlug? }) → SwarmRoutingDecision[]。
 *
 * 决策顺序（仅在线设备，不做网关降级）：
 * 1. manual：devices.sub_role_bindings 里该子角色 slug → agentType；
 * 2. preferred：子角色 preferred_agent_type（该设备有此平台、在线且已激活）；
 * 3. capability：required_capabilities 能力兜底（匹配设备可用且已激活的 agent 平台）；
 * 4. 全不匹配 → 空数组（任务保持 queued，由调度器周期重试）。
 *
 * 同一 tier 内收集全部命中而非提前返回，供调度器逐个尝试认领（满员则换下一个候选）。
 */

export class SwarmRouter {
  /**
   * 解析软绑定路由决策（取优先级最高的候选，供调试/预览与旧调用使用）。
   * @param roleTeamId 蜂群角色团队 id
   * @param subRoleSlug 目标子角色 slug（缺省取团队第一个子角色）
   */
  resolve(input: { roleTeamId: string; subRoleSlug?: string }): SwarmRoutingDecision | null {
    return this.resolveCandidates(input)[0] ?? null;
  }

  /**
   * 解析完整候选列表（按三级优先级排序：manual → preferred → capability）。
   *
   * 返回列表而非单一决策，是为了让调度器在首个候选已满员（认领失败）时
   * 继续尝试后续候选（同团队其它设备 / 同设备其它平台），避免任务永久 queued。
   *
   * @param roleTeamId 蜂群角色团队 id
   * @param subRoleSlug 目标子角色 slug（缺省取团队第一个子角色）
   */
  resolveCandidates(input: { roleTeamId: string; subRoleSlug?: string }): SwarmRoutingDecision[] {
    const team = getRoleTeam(input.roleTeamId);
    if (!team) return [];

    const subRole = input.subRoleSlug
      ? getSubRole(input.roleTeamId, input.subRoleSlug)
      : listSubRoles(input.roleTeamId)[0];
    if (!subRole) return [];

    const systemPrompt = buildSystemPrompt(subRole);
    const bound = listDevicesByRoleTeam(input.roleTeamId);
    if (bound.length === 0) return [];

    // 软绑定只考虑在线设备（离线设备无法派发，保持 queued）
    const online = bound.filter((id) => deviceRegistry.isOnline(id));
    const out: SwarmRoutingDecision[] = [];

    // 1) 手动软绑定：用户显式绑定，尊重意图不校验激活状态（激活与否由用户自负）
    for (const deviceId of online) {
      const agentType = getSubRoleBindings(deviceId)[subRole.slug] as AgentType | undefined;
      if (!agentType) continue;
      const agent = this.findAgent(deviceId, agentType, false);
      if (agent) {
        out.push(this.decision(input.roleTeamId, subRole, deviceId, agentType, 'manual', systemPrompt));
      }
    }

    // 2) 偏好平台（需已激活，与 capability 级口径一致）
    if (subRole.preferredAgentType) {
      for (const deviceId of online) {
        const agent = this.findAgent(deviceId, subRole.preferredAgentType, true);
        if (agent) {
          out.push(
            this.decision(
              input.roleTeamId,
              subRole,
              deviceId,
              subRole.preferredAgentType,
              'preferred',
              systemPrompt,
            ),
          );
        }
      }
    }

    // 3) 能力兜底（需已激活）
    for (const deviceId of online) {
      const agent = this.findCapabilityAgent(deviceId, subRole);
      if (agent) {
        out.push(
          this.decision(input.roleTeamId, subRole, deviceId, agent.agent_type, 'capability', systemPrompt),
        );
      }
    }

    // 4) 全不匹配 → 空数组（任务保持 queued）
    return out;
  }

  /** 查找设备上指定平台的可用 agent（requireActivated=true 时额外校验已激活） */
  private findAgent(deviceId: string, agentType: AgentType, requireActivated: boolean): AgentRow | undefined {
    const agent = listAgentsByDevice(deviceId).find((a) => a.agent_type === agentType);
    if (!agent) return undefined;
    if (agent.status === 'error') return undefined;
    if (requireActivated && agent.activated !== 1) return undefined;
    return agent;
  }

  /** 按 required_capabilities 匹配设备上「可用且已激活」的 agent 平台 */
  private findCapabilityAgent(deviceId: string, subRole: SubRole): AgentRow | undefined {
    const required = subRole.requiredCapabilities ?? [];
    const candidates = listAgentsByDevice(deviceId).filter(
      (a) => a.status !== 'error' && a.activated === 1,
    );
    if (candidates.length === 0) return undefined;
    if (required.length === 0) return candidates[0];
    return (
      candidates.find((a) => {
        const caps = JSON.parse(a.capabilities || '[]') as string[];
        return required.every((c) => caps.includes(c));
      }) ?? undefined
    );
  }

  private decision(
    roleTeamId: string,
    subRole: SubRole,
    deviceId: string,
    agentType: AgentType,
    source: SwarmRoutingDecision['source'],
    systemPrompt: string,
  ): SwarmRoutingDecision {
    return { roleTeamId, subRoleSlug: subRole.slug, deviceId, agentType, source, systemPrompt };
  }
}

/** 全局单例 */
export const swarmRouter = new SwarmRouter();
