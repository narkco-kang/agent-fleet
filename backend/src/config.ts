import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { BACKEND_PORT, HEARTBEAT_TIMEOUT_MS, PAIR_CODE_TTL_MS, RELAY_PORT } from '@agentfleet/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(rootDir, '.env') });

/** 运行时配置：从环境变量读取，缺省使用 shared 中的默认值 */
export interface BackendConfig {
  host: string;
  port: number;
  dbPath: string;
  relayHost: string;
  relayPort: number;
  relaySecret: string;
  /** 协调服务作为客户端连中继的地址（可选，空则不连） */
  relayUrl: string;
  pairCodeTtlMs: number;
  heartbeatTimeoutMs: number;
  /** modelgateway 可选后端地址（协议对接，默认 127.0.0.1:18765） */
  modelGatewayUrl: string;
  /** modelgateway 请求/健康探测超时（毫秒） */
  modelGatewayTimeoutMs: number;
  /** SSH 连接超时（毫秒） */
  sshConnectTimeoutMs: number;
  /** SSH exec 命令超时（毫秒） */
  sshExecTimeoutMs: number;
  /** 部署/卸载命令执行超时（毫秒）。npm/pipx 安装耗时数分钟，需远大于 sshExecTimeoutMs */
  deployExecTimeoutMs: number;
  /** 部署功能开关 */
  deployEnabled: boolean;
  /** 人工确认开关：false 时对外动作自动放行（仍留审计记录） */
  actionGuardEnabled: boolean;
  /** 角色路由表 JSON 文件路径（启动时导入，空则跳过） */
  roleRoutesJsonPath: string;
}

export const config: BackendConfig = {
  host: process.env.BACKEND_HOST ?? '0.0.0.0',
  port: Number(process.env.BACKEND_PORT ?? BACKEND_PORT),
  dbPath: path.resolve(
    rootDir,
    process.env.DB_PATH ?? './data/agentfleet.db',
  ),
  relayHost: process.env.RELAY_HOST ?? '0.0.0.0',
  relayPort: Number(process.env.RELAY_PORT ?? RELAY_PORT),
  relaySecret: process.env.RELAY_SECRET ?? '',
  relayUrl: process.env.RELAY_URL ?? '',
  pairCodeTtlMs: Number(process.env.PAIR_CODE_TTL_MS ?? PAIR_CODE_TTL_MS),
  heartbeatTimeoutMs: Number(process.env.HEARTBEAT_TIMEOUT_MS ?? HEARTBEAT_TIMEOUT_MS),
  modelGatewayUrl: process.env.MODELGATEWAY_URL ?? 'http://127.0.0.1:18765',
  modelGatewayTimeoutMs: Number(process.env.MODELGATEWAY_TIMEOUT_MS ?? 5_000),
  sshConnectTimeoutMs: Number(process.env.SSH_CONNECT_TIMEOUT_MS ?? 10_000),
  sshExecTimeoutMs: Number(process.env.SSH_EXEC_TIMEOUT_MS ?? 30_000),
  deployExecTimeoutMs: Number(process.env.DEPLOY_EXEC_TIMEOUT_MS ?? 600_000),
  deployEnabled: process.env.DEPLOY_ENABLED !== '0',
  actionGuardEnabled: process.env.ACTION_GUARD_ENABLED !== '0',
  roleRoutesJsonPath: process.env.ROLE_ROUTES_JSON ?? '',
};
