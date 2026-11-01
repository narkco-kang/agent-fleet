import crypto from 'node:crypto';

/**
 * 设备 token 签发/校验。
 *
 * 签名方式：HMAC-SHA256(secret, deviceId)，token = `${deviceId}.${sig}`。
 * secret 默认由本地持久化派生（无外部依赖时随机生成，进程内稳定）。
 */

let serverSecret: string | null = null;

/** 获取服务端签名密钥（进程内惰性生成，重启后变化 => 旧 token 失效） */
export function getServerSecret(): string {
  if (!serverSecret) {
    const env = process.env.AGENTMESH_SECRET;
    serverSecret = env && env.length >= 16 ? env : crypto.randomBytes(32).toString('hex');
  }
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
