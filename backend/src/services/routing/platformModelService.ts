import type { AgentType, PlatformModelBinding, PlatformModelConfig } from '@agentmesh/shared';
import {
  deleteBinding,
  getBinding,
  listBindings,
  setActive,
  upsertBinding,
} from '../../db/repo/platformModels.js';

/**
 * 平台模型绑定服务：为「设备 + agent 平台」配置经 modelgateway 执行的模型。
 *
 * - bind / bindPlatformModels：部署完成即用（或手动配置）
 * - resolve：返回健康绑定（state=ok），供 scheduler 决定是否走网关
 * - markModelFailed：模型失败 → 自动切换下一个兜底模型；全部失败 → degraded（降级本地）
 * - switchModel：手动切换到一个已知模型
 * - reset：手动恢复健康
 */

/** 单条绑定 */
export function bind(
  deviceId: string,
  agentType: AgentType,
  model: string,
  fallbacks: string[] = [],
): PlatformModelBinding {
  if (!deviceId || !model) throw new Error('deviceId and model required');
  return upsertBinding({ deviceId, agentType, model, fallbacks, activeModel: model, state: 'ok' });
}

/** 批量绑定（部署完成后调用），返回成功条数 */
export function bindPlatformModels(deviceId: string, configs: PlatformModelConfig[]): number {
  let n = 0;
  for (const c of configs) {
    bind(deviceId, c.agentType, c.model, c.fallbacks ?? []);
    n++;
  }
  return n;
}

export function unbind(deviceId: string, agentType?: AgentType): number {
  return deleteBinding(deviceId, agentType);
}

export function list(): PlatformModelBinding[] {
  return listBindings();
}

/** 健康绑定（state=ok）才返回，供调度器使用 */
export function resolve(deviceId: string, agentType: AgentType): PlatformModelBinding | undefined {
  const b = getBinding(deviceId, agentType);
  if (!b || b.state !== 'ok') return undefined;
  return b;
}

/** 模型失败：排除该模型并切换到下一个可用兜底；无可用 → degraded */
export function markModelFailed(
  deviceId: string,
  agentType: AgentType,
  failedModel: string,
): { degraded: boolean; switchedTo?: string } {
  const b = getBinding(deviceId, agentType);
  if (!b) return { degraded: false };
  const order = [b.model, ...b.fallbacks];
  const excluded = new Set([...b.excluded, failedModel]);
  const next = order.find((m) => !excluded.has(m));
  if (next) {
    setActive(deviceId, agentType, next, 'ok', Array.from(excluded));
    return { degraded: false, switchedTo: next };
  }
  setActive(deviceId, agentType, b.activeModel, 'degraded', Array.from(excluded));
  return { degraded: true };
}

/** 手动切换到一个已知模型（主模型或兜底），并恢复健康 + 清空排除表 */
export function switchModel(deviceId: string, agentType: AgentType, model: string): PlatformModelBinding | undefined {
  const b = getBinding(deviceId, agentType);
  if (!b) return undefined;
  const known = [b.model, ...b.fallbacks];
  if (!known.includes(model)) throw new Error(`unknown model: ${model}`);
  return setActive(deviceId, agentType, model, 'ok', []);
}

/** 手动恢复健康（重试当前 activeModel）+ 清空排除表 */
export function reset(deviceId: string, agentType: AgentType): PlatformModelBinding | undefined {
  const b = getBinding(deviceId, agentType);
  if (!b) return undefined;
  return setActive(deviceId, agentType, b.activeModel, 'ok', []);
}
