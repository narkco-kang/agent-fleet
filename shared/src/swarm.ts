import type { AgentType } from './status.js';

/**
 * 蜂群角色团队协议（swarm）：
 * 一个「角色团队」由若干「子角色」组成，每个子角色携带 persona（身份/沟通/规则/风格）
 * 与 operation（使命/工作流/交付物）。任务以 target.mode='swarm' 下发时，调度器按
 * 三级软绑定（手动绑定 → 偏好平台 → 能力兜底）解析目标设备 + agent 平台，并把 persona
 * 注入为 systemPrompt 派发到设备侧执行。
 */

/** 团队用途分类（自由字符串，内置几个常用值供 UI 选择） */
export type SwarmPurpose = 'software' | 'content' | 'security' | 'research' | 'general' | string;

/** 子角色 persona（设备侧注入的 system 上下文来源） */
export interface SubRolePersona {
  /** 身份定位（一句话描述我是谁） */
  identity: string;
  /** 沟通方式（如何协作/汇报） */
  communication: string;
  /** 行为准则列表（硬约束） */
  rules: string[];
  /** 行文风格 */
  style: string;
}

/** 子角色 operation（使命/工作流/交付物） */
export interface SubRoleOperation {
  /** 任务使命（本角色要达成什么） */
  mission: string;
  /** 工作流程（有序步骤） */
  workflow: string[];
  /** 交付物清单 */
  deliverables: string[];
}

/** 蜂群子角色 */
export interface SubRole {
  subRoleId: string;
  roleTeamId: string;
  /** 全局唯一（同一团队内），[a-z0-9-] */
  slug: string;
  name: string;
  description: string;
  /** 该角色具备的能力标签 */
  capabilities: string[];
  persona: SubRolePersona;
  operation: SubRoleOperation;
  /** 偏好平台（软绑定第 2 级：该平台在设备上可用且在线时命中） */
  preferredAgentType?: AgentType;
  /** 软绑定第 3 级：能力兜底（匹配设备可用且已激活的 agent 平台） */
  requiredCapabilities: string[];
  /** 排序权重（升序） */
  position: number;
}

/** 蜂群角色团队 */
export interface RoleTeam {
  roleTeamId: string;
  name: string;
  /** 全局唯一，[a-z0-9-] */
  slug: string;
  description: string;
  purpose: SwarmPurpose;
  /** 有序子角色 slug 数组（冗余，便于快速展示；事实源为 sub_roles 表） */
  subRoleIds: string[];
  /** Leader 子角色 slug（P2-4：未指定 subRole 的任务先路由到 Leader 协调） */
  leaderSlug?: string;
  version: number;
  isPreset: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 软绑定路由决策结果 */
export interface SwarmRoutingDecision {
  roleTeamId: string;
  subRoleSlug: string;
  /** 命中本地设备时返回 */
  deviceId?: string;
  /** 命中本地设备时返回 */
  agentType?: AgentType;
  /** manual=手动绑定；preferred=偏好平台；capability=能力兜底 */
  source: 'manual' | 'preferred' | 'capability';
  /** persona 注入上下文（下发到设备侧合并） */
  systemPrompt: string;
}
