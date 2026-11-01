import type { AgentType } from './status.js';
import type { RoleRoute } from './routing.js';

/**
 * 专家团队协议（F5）：复用角色概念，不新造团队模型。
 * 支持单设备团队（成员 deviceId 相同）与跨设备团队（成员 deviceId 可空/分散）。
 */

/** 团队成员 */
export interface TeamMember {
  /** 复用角色概念 */
  role: string;
  /** 可空 = 路由时再定（Q8） */
  deviceId?: string;
  agentType?: AgentType;
}

/** 专家团队 */
export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  /** role → 路由（复用 RG 概念，不新造） */
  routes: Record<string, RoleRoute>;
  createdAt: number;
  updatedAt: number;
}
