import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { WECHAT_PORT } from '@agentmesh/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(rootDir, '.env') });

/** 微信网关运行配置 */
export interface WechatConfig {
  host: string;
  port: number;
  corpId: string;
  agentId: string;
  corpSecret: string;
  token: string;
  encodingAESKey: string;
  backendUrl: string;
}

export const config: WechatConfig = {
  host: process.env.WECHAT_HOST ?? '0.0.0.0',
  port: Number(process.env.WECHAT_PORT ?? WECHAT_PORT),
  corpId: process.env.WECOM_CORP_ID ?? '',
  agentId: process.env.WECOM_AGENT_ID ?? '',
  corpSecret: process.env.WECOM_CORP_SECRET ?? '',
  token: process.env.WECOM_TOKEN ?? '',
  encodingAESKey: process.env.WECOM_ENCODING_AES_KEY ?? '',
  backendUrl: process.env.WECHAT_BACKEND_URL ?? 'http://127.0.0.1:4173',
};
