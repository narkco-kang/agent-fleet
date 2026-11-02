import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * 设备 token 签发/校验。
 *
 * 签名方式：HMAC-SHA256(secret, deviceId)，token = `${deviceId}.${sig}`。
 * secret 来源优先级：
 *   1. 环境变量 AGENTMESH_SECRET（多协调器共享密钥时用）；
 *   2. DB 同目录下的 `.server-secret` 文件（首次自动生成，之后复用）；
 *   3. 落盘失败时退回进程内随机（仅当次运行有效）。
 */

let serverSecret: string | null = null;

/** 密钥文件路径：与 DB 同目录，保证不同实例（含测试临时目录）密钥隔离 */
function secretFilePath(): string {
  return path.join(path.dirname(config.dbPath), '.server-secret');
}

/**
 * 获取服务端签名密钥。
 *
 * 必须持久化：否则每次重启都换密钥，所有已配对设备的 token 立即失效 ——
 * 设备注册被拒后仍会发心跳，表现为「看板在线但身份无效」，设备名/能力也不更新。
 */
export function getServerSecret(): string {
  if (serverSecret) return serverSecret;

  const env = process.env.AGENTMESH_SECRET;
  if (env && env.length >= 16) {
    serverSecret = env;
    return serverSecret;
  }

  const file = secretFilePath();
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf-8').trim();
      // 长度校验：截断/损坏的密钥文件视为无效，重新生成
      if (saved.length >= 32) {
        serverSecret = saved;
        return serverSecret;
      }
    }
  } catch {
    /* 读取失败 → 走重新生成 */
  }

  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 0600：仅当前用户可读写
    fs.writeFileSync(file, fresh, { mode: 0o600 });
  } catch (err) {
    console.warn(
      '[auth] 服务端密钥落盘失败，重启后已配对设备 token 将失效:',
      (err as Error).message,
    );
  }
  serverSecret = fresh;
  return serverSecret;
}

/** 签发设备长期 token */
export function issueToken(deviceId: string): string {
  const sig = crypto
    .createHmac('sha256', getServerSecret())
    .update(deviceId)
    .digest('base64url');
  return `${deviceId}.${sig}`;
}

/** 校验 token（返回是否有效） */
export function verifyToken(deviceId: string, token: string): boolean {
  if (!token) return false;
  const [id, sig] = token.split('.');
  if (id !== deviceId || !sig) return false;
  const expected = crypto
    .createHmac('sha256', getServerSecret())
    .update(deviceId)
    .digest('base64url');
  // 长度对齐后恒定时间比较
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 生成随机会话/消息 ID */
export function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
