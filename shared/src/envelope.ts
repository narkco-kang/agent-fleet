import type { MessageType } from './messageTypes.js';

/**
 * 统一消息信封 —— 所有 WS 消息必须包 Envelope，业务内容放 payload。
 */
export interface Envelope<T = unknown> {
  /** 协议版本 */
  v: 1;
  /** 消息类型（见 messageTypes） */
  type: MessageType;
  /** 消息唯一 ID（uuid） */
  id: string;
  /** 发送时间戳（epoch ms） */
  ts: number;
  /** 发送方 ID：'coordinator' | deviceId | 'wechat' | 'dashboard' */
  from: string;
  /** 接收方 ID：'coordinator' | deviceId | 'wechat' | 'dashboard' */
  to: string;
  /** 业务载荷 */
  payload: T;
}

/**
 * 构造一个消息信封（自动填充 v/ts，可选 id/from/to）。
 */
export function makeEnvelope<T>(
  type: MessageType,
  payload: T,
  opts: { id?: string; from?: string; to?: string; ts?: number } = {},
): Envelope<T> {
  return {
    v: 1,
    type,
    id: opts.id ?? cryptoRandomId(),
    ts: opts.ts ?? Date.now(),
    from: opts.from ?? 'unknown',
    to: opts.to ?? 'unknown',
    payload,
  };
}

/**
 * 生成一个带时间戳前缀的随机 ID（无需额外依赖 crypto）。
 * Node 与浏览器均可用；Node 侧 crypto 为全局对象。
 */
export function cryptoRandomId(prefix = 'msg'): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}-${c.randomUUID()}`;
  }
  const bytes = new Uint8Array(8);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}-${hex}-${Date.now().toString(36)}`;
}

/** 解析 Envelope JSON（容错） */
export function parseEnvelope(raw: string): Envelope | null {
  try {
    const obj = JSON.parse(raw) as Envelope;
    if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}
