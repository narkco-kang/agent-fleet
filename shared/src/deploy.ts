import type { AgentType, DeployOS, DeployTargetStatus, DeploymentBatchStatus } from './status.js';

/**
 * 批量部署协议（F1）：Excel 解析 → SSH → OS 探测 → 安装 → 回报。
 *
 * 安全红线：DeploymentTarget **不含密码**；密码仅存内存 DeploymentCredential，
 * 执行后立即清除（绝不落库）。
 */

/** 部署批次 */
export interface DeploymentBatch {
  id: string;
  name: string;
  status: DeploymentBatchStatus;
  targets: DeploymentTarget[];
  createdAt: number;
}

/** 部署目标（无密码列） */
export interface DeploymentTarget {
  id: string;
  batchId: string;
  ip: string;
  user: string;
  /** SSH 探测后填充 */
  os: DeployOS;
  /** 要安装的 agent 平台 */
  platforms: AgentType[];
  status: DeployTargetStatus;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

/** 内存凭证（密码绝不落库） */
export interface DeploymentCredential {
  targetId: string;
  password: string;
}
