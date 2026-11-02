import type { AgentType, DeployOS, DeployTargetStatus, DeploymentBatchStatus } from './status.js';
import type { PlatformModelConfig } from './routing.js';

/**
 * 批量部署协议（F1）：Excel 解析 → SSH → OS 探测 → 安装 → 回报。
 *
 * 安全红线：DeploymentTarget **不含密码**；密码仅存内存 DeploymentCredential，
 * 执行后立即清除（绝不落库）。
 */

/** 部署批次类型（install=一键部署，uninstall=一键卸载） */
export type DeploymentKind = 'deploy' | 'uninstall';

/** 部署批次 */
export interface DeploymentBatch {
  id: string;
  name: string;
  kind: DeploymentKind;
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
  /** SSH 端口（默认 22） */
  port?: number;
  /** 若目标机是已注册 AgentFleet 设备，部署成功后据此绑定模型 */
  deviceId?: string;
  /** SSH 探测后填充 */
  os: DeployOS;
  /** 要安装的 agent 平台 */
  platforms: AgentType[];
  /** 部署成功后为各平台绑定的网关模型 */
  modelConfigs?: PlatformModelConfig[];
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
