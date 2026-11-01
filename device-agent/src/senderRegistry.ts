import type { Envelope } from '@agentmesh/shared';

/**
 * 活跃发送通道注册表：直连协调服务 socket + 中继连接。
 * 心跳/注册/能力上报对全部活跃通道广播。
 */
export interface Sender {
  send(envelope: Envelope): void;
  label: string;
}

const senders = new Set<Sender>();

export function addSender(s: Sender): void {
  senders.add(s);
}

export function removeSender(s: Sender): void {
  senders.delete(s);
}

export function sendToAll(envelope: Envelope): void {
  for (const s of senders) {
    try {
      s.send(envelope);
    } catch {
      /* 单通道失败不阻塞其他通道 */
    }
  }
}

export function hasSenders(): boolean {
  return senders.size > 0;
}
