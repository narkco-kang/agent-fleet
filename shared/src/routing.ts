import type { AgentType, RoleCapability } from './status.js';

/**
 * 角色路由协议（对齐 modelgateway data/agent-role-routes.json 结构，
 * 并泛化为「角色 → 设备 + agent + 模型」）。
 *
 * - `primary` / `fallback`：对齐 modelgateway 的 provider/group/model ref
 * - `deviceId` / `agentType` / `model`：AgentMesh 侧泛化字段
 */

/** 角色路由条目 */
export interface RoleRoute {
  /** 角色名，如 'research' | 'execution' | 'reasoning' | 'review-verdict'（string 不锁死，可自定义） */
  role: string;
  /** 主路由 ref：provider/group/model 或 device+agent 标识 */
  primary: string;
  /** 兜底路由 ref 列表（三级兜底，对齐 modelgateway） */
  fallback: string[];
  /** 角色能力 */
  capability: RoleCapability;
  /** 对应 bot 展示名（对齐 agent-role-routes.json） */
  bots: string[];
  /** 【泛化】指定设备（可空 = 路由时再定） */
  deviceId?: string;
  /** 【泛化】指定 agent 平台 */
  agentType?: AgentType;
  /** 【泛化】指定模型（经 modelgateway 透传） */
  model?: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 角色路由决策结果 */
export interface RoleRoutingDecision {
  role: string;
  resolved: {
    /** 命中本地 agent 时返回 */
    deviceId?: string;
    /** 命中本地 agent 时返回 */
    agentType?: AgentType;
    /** 命中 modelgateway 模型时返回（如 'kimi/k3.1-pro-highspeed'） */
    modelRef?: string;
    /** bot 展示名 */
    botName?: string;
  };
  /** true = 经 modelgateway 执行；false = 本地设备 agent 执行 */
  viaGateway: boolean;
  /** 0=primary，1..n=fallback 序号 */
  fallbackLevel: number;
}
