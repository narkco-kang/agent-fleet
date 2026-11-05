/**
 * 消息类型 —— 点分小写：`域.动作`（见 03 §6.1）
 */
export type MessageType =
  // 设备 ↔ 协调服务
  | 'device.register'
  | 'device.register_ack'
  | 'device.heartbeat'
  | 'device.capabilities'
  | 'device.pair'
  | 'device.pair_ack'
  | 'device.pair_request'
  | 'device.pair_result'
  | 'device.relay_online'
  | 'device.relay_offline'
  | 'device.platform_open'
  | 'device.platform_open_ack'
  // 设备登录授权（Device Auth Flow 中继：看板统一完成各设备 agent 的登录授权）
  | 'device.login_request'
  | 'device.login_challenge'
  | 'device.login_result'
  // 一键配置模型（免登录：给设备上的 codex/claude 写自定义模型配置，走免费源）
  | 'device.model_config'
  | 'device.model_config_ack'
  // 任务下发 / 流转
  | 'task.submit'
  | 'task.submit_ack'
  | 'task.event'
  | 'task.cancel'
  | 'task.result'
  | 'task.reroute'
  | 'task.decision_gate'
  // 资产分发（协调 ↔ 设备）
  | 'asset.deliver'
  | 'asset.deliver_ack'
  // 看板订阅
  | 'dashboard.snapshot'
  | 'dashboard.patch'
  // 微信
  | 'wechat.message'
  | 'wechat.reply'
  // 记忆账本同步（backend leader 广播 + 设备补同步）
  | 'memory.block_broadcast'
  | 'memory.chain_summary'
  | 'memory.block_response'
  | 'memory.block_request'
  | 'memory.block_reject';

/**
 * 消息类型常量集合（运行时可用，避免字符串漂移）。
 */
export const MESSAGE_TYPES: Record<string, MessageType> = {
  DEVICE_REGISTER: 'device.register',
  DEVICE_REGISTER_ACK: 'device.register_ack',
  DEVICE_HEARTBEAT: 'device.heartbeat',
  DEVICE_CAPABILITIES: 'device.capabilities',
  DEVICE_PAIR: 'device.pair',
  DEVICE_PAIR_ACK: 'device.pair_ack',
  DEVICE_PAIR_REQUEST: 'device.pair_request',
  DEVICE_PAIR_RESULT: 'device.pair_result',
  DEVICE_RELAY_ONLINE: 'device.relay_online',
  DEVICE_RELAY_OFFLINE: 'device.relay_offline',
  DEVICE_PLATFORM_OPEN: 'device.platform_open',
  DEVICE_PLATFORM_OPEN_ACK: 'device.platform_open_ack',
  DEVICE_LOGIN_REQUEST: 'device.login_request',
  DEVICE_LOGIN_CHALLENGE: 'device.login_challenge',
  DEVICE_LOGIN_RESULT: 'device.login_result',
  DEVICE_MODEL_CONFIG: 'device.model_config',
  DEVICE_MODEL_CONFIG_ACK: 'device.model_config_ack',
  TASK_SUBMIT: 'task.submit',
  TASK_SUBMIT_ACK: 'task.submit_ack',
  TASK_EVENT: 'task.event',
  TASK_CANCEL: 'task.cancel',
  TASK_RESULT: 'task.result',
  TASK_REROUTE: 'task.reroute',
  DECISION_GATE: 'task.decision_gate',
  ASSET_DELIVER: 'asset.deliver',
  ASSET_DELIVER_ACK: 'asset.deliver_ack',
  DASHBOARD_SNAPSHOT: 'dashboard.snapshot',
  DASHBOARD_PATCH: 'dashboard.patch',
  WECHAT_MESSAGE: 'wechat.message',
  WECHAT_REPLY: 'wechat.reply',
  MEMORY_BLOCK_BROADCAST: 'memory.block_broadcast',
  MEMORY_CHAIN_SUMMARY: 'memory.chain_summary',
  MEMORY_BLOCK_RESPONSE: 'memory.block_response',
  MEMORY_BLOCK_REQUEST: 'memory.block_request',
  MEMORY_BLOCK_REJECT: 'memory.block_reject',
} as const;
