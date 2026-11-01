/**
 * 个人微信受限通道（接口预留 + 降级提示）。
 *
 * 定义 onMessage/onReply 接口；MVP 未接入个人微信协议，
 * 一律返回明确「未接入」降级提示。
 */
export interface PersonalMessage {
  fromUser: string;
  content: string;
}

export interface PersonalGateway {
  onMessage(handler: (msg: PersonalMessage) => string): void;
  reply(toUser: string, content: string): void;
}

export const personalGateway: PersonalGateway = {
  onMessage(): void {
    /* 未接入：无通道可监听 */
  },
  reply(): void {
    /* 未接入：无通道可回复 */
  },
};

/** 个人微信通道是否可用 */
export function personalGatewayAvailable(): boolean {
  return false;
}

/** 降级提示文案 */
export function personalDegradeHint(): string {
  return '个人微信通道尚未接入（接口已预留）。请改用企业微信或 Web 看板下发任务。';
}
