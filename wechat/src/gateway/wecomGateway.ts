import { getSignature, decrypt, encrypt } from '@wecom/crypto';
import { config } from '../config.js';

/**
 * 企业微信回调验签/解密 + 被动回复。
 * 未配置 token/aesKey 时降级返回 null（不抛错）。
 */

export interface WecomInbound {
  fromUser: string;
  content: string;
  msgType: string;
}

/** 回调 URL 验证：返回 echostr（验签失败返回 null） */
export function verifyUrl(
  signature: string,
  timestamp: string,
  nonce: string,
  echostr: string,
): string | null {
  if (!config.token || !config.encodingAESKey) return null;
  const expected = getSignature(config.token, timestamp, nonce, echostr);
  if (signature !== expected) return null;
  try {
    const { message } = decrypt(config.encodingAESKey, echostr);
    return message;
  } catch {
    return null;
  }
}

/** 解析回调解密消息（验签失败返回 null） */
export function decryptMessage(
  signature: string,
  timestamp: string,
  nonce: string,
  encryptBody: string,
): WecomInbound | null {
  if (!config.token || !config.encodingAESKey) return null;
  try {
    const expected = getSignature(config.token, timestamp, nonce, encryptBody);
    if (signature !== expected) return null;
    const { message } = decrypt(config.encodingAESKey, encryptBody);
    return parseXmlMessage(message);
  } catch {
    return null;
  }
}

/** 构造被动回复加密体 */
export function buildReply(toUser: string, content: string, timestamp: string, nonce: string): string | null {
  if (!config.token || !config.encodingAESKey || !config.corpId) return null;
  const xml = `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${config.corpId}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${escapeXml(content)}]]></Content></xml>`;
  const ciphered = encrypt(config.encodingAESKey, xml, config.corpId);
  const signature = getSignature(config.token, timestamp, nonce, ciphered);
  return `<xml><Encrypt><![CDATA[${ciphered}]]></Encrypt><MsgSignature><![CDATA[${signature}]]></MsgSignature><TimeStamp>${timestamp}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`;
}

/** 解析企业微信解密后的 XML 消息（仅提取文本消息核心字段） */
export function parseXmlMessage(xml: string): WecomInbound {
  const fromUser = grab(xml, 'FromUserName');
  const content = grab(xml, 'Content');
  const msgType = grab(xml, 'MsgType') || 'text';
  return { fromUser, content, msgType };
}

function grab(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)) ??
    xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
