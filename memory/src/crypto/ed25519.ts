/**
 * Ed25519 密钥 / 签名 / 验签 + 公钥信任表（node:crypto，零第三方依赖）。
 *
 * 约定：签名对象是 `block.hash`（64 位小写 hex），以 UTF-8 字节输入；
 * signature 为 Ed25519 原始 64 字节的 base64。genesis 无签名，验签时特殊放行。
 */
import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

/** 密钥对（PEM 字符串）。 */
export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/** 生成一对 Ed25519 密钥（PEM 编码）。 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** 用私钥对消息签名，返回 base64。 */
export function sign(privateKeyPem: string, message: string): string {
  const signature = cryptoSign(null, Buffer.from(message, 'utf8'), privateKeyPem);
  return signature.toString('base64');
}

/** 用公钥验签；任何异常（坏 PEM / 坏 base64）均视为失败返回 false。 */
export function verify(
  publicKeyPem: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(message, 'utf8'),
      publicKeyPem,
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * 本地公钥信任表：配对时登记 deviceId → 公钥，验签时查表得公钥。
 */
export class TrustStore {
  private readonly keys = new Map<string, string>();

  /** 登记（或覆盖）某 author 的公钥。 */
  register(author: string, publicKeyPem: string): void {
    this.keys.set(author, publicKeyPem);
  }

  /** 查询某 author 的公钥，未登记返回 undefined。 */
  get(author: string): string | undefined {
    return this.keys.get(author);
  }

  /** 是否已登记该 author。 */
  has(author: string): boolean {
    return this.keys.has(author);
  }

  /** 移除某 author 的信任记录。 */
  remove(author: string): boolean {
    return this.keys.delete(author);
  }

  /** 已登记数量。 */
  size(): number {
    return this.keys.size;
  }
}
