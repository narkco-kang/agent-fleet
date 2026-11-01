/** 微信网关相关协议类型 */

import type { AgentType, Origin } from './status.js';

/** 微信消息（wechat.message） */
export interface WechatMessage {
  channel: 'personal' | 'work';
  fromUser: string;
  content: string;
  msgType: 'text' | 'image' | 'voice' | 'event';
  ts: number;
}

/** 微信回复（wechat.reply） */
export interface WechatReply {
  channel: 'personal' | 'work';
  toUser: string;
  content: string;
  msgType: 'text';
  /** 可选：关联的任务 ID */
  taskId?: string;
  ts: number;
}

/** 命令解析结果 */
export interface ParsedCommand {
  kind: 'status' | 'cancel' | 'help' | 'task';
  /** 裸文本任务 prompt（kind=task 时有效） */
  prompt?: string;
  /** /cancel #id 的任务 ID */
  taskId?: string;
  /** 解析失败或需要提示时的文案 */
  message?: string;
  target?: {
    mode: 'auto' | 'device' | 'agent';
    deviceId?: string;
    agentType?: AgentType;
  };
  origin: Origin;
}
