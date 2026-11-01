import type { AgentType, RoleRoute, RoleRoutingDecision } from '@agentmesh/shared';
import { roleRouteStore } from './roleRouteStore.js';
import { modelGatewayClient } from './modelGatewayClient.js';
import { deviceRegistry } from '../deviceRegistry.js';
import { listAgentsByDevice } from '../../db/repo/agents.js';

/**
 * 角色路由决策：decide(role, ctx) → RoleRoutingDecision。
 *
 * 决策顺序：primary 可用 → fallback[0] → fallback[1]；每级判断
 * 「本地 agent 在线」或「modelgateway 在线」。
 * - 本地：角色路由指定 deviceId + agentType，且该设备在线、agent 可用 → viaGateway=false
 * - 网关：角色路由指定 model（或 primary 作为 model ref），且 modelgateway 可用 → viaGateway=true
 * - 全部不可用 → null（任务保持 queued，由调度器周期重试）
 *
 * 结果被 scheduler.pickTarget 与 teamService.resolveTeamRoutes 复用，不重复实现决策。
 */

/** 路由上下文 */
export interface RoutingContext {
  taskId?: string;
  sessionId?: string;
  prompt?: string;
  /** 优先本地（默认 true） */
  preferLocal?: boolean;
}

class RoleRouter {
  /** 本地 agent 是否在线且可用 */
  private isLocalAgentAvailable(deviceId: string, agentType: AgentType): boolean {
    if (!deviceRegistry.isOnline(deviceId)) return false;
    const agent = listAgentsByDevice(deviceId).find((a) => a.agent_type === agentType);
    if (!agent) return false;
    return agent.status !== 'error';
  }

  /** modelgateway 是否可用 */
  isGatewayAvailable(): boolean {
    return modelGatewayClient.isAvailable();
  }

  /** 决策（routesOverride 供 Team.routes 复用角色路由概念时覆盖全局表） */
  decide(
    role: string,
    ctx?: RoutingContext,
    routesOverride?: Record<string, RoleRoute>,
  ): RoleRoutingDecision | null {
    const route = (routesOverride ? routesOverride[role] : undefined) ?? roleRouteStore.get(role);
    if (!route || !route.enabled) return null;

    const hasLocal = Boolean(route.deviceId && route.agentType);
    const hasModel = Boolean(route.model);
    const preferLocal = ctx?.preferLocal !== false;

    // 1) 本地 agent 绑定优先（泛化单一绑定）
    if (preferLocal && hasLocal) {
      if (this.isLocalAgentAvailable(route.deviceId as string, route.agentType as AgentType)) {
        return {
          role,
          resolved: {
            deviceId: route.deviceId,
            agentType: route.agentType,
            botName: route.bots[0],
          },
          viaGateway: false,
          fallbackLevel: 0,
        };
      }
    }

    // 2) 网关路径：有显式 model，或纯 modelgateway 风格路由（无本地绑定时 primary 即 model ref）。
    //    本地绑定的路由若无 model，不回退到「把 primary 当 model」——本地离线则返回 null。
    const canUseGateway = hasModel || !hasLocal;
    if (canUseGateway && this.isGatewayAvailable()) {
      const modelRef = route.model ?? route.primary;
      if (modelRef) {
        return {
          role,
          resolved: {
            modelRef,
            botName: route.bots[0],
          },
          viaGateway: true,
          // hasLocal 时本地离线 → 降级到网关，记为 fallbackLevel 1
          fallbackLevel: hasLocal ? 1 : 0,
        };
      }
    }

    return null;
  }
}

/** 全局单例 */
export const roleRouter = new RoleRouter();
