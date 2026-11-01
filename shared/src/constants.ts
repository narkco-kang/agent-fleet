/**
 * 共享协议常量 —— 跨文件约定（见 03-开发文档图谱 §6）
 *
 * 单一事实源：后端 / 设备守护 / 前端 / 微信网关四处均通过
 * `@agentmesh/shared` 引用本文件，避免端口、命名、间隔漂移。
 */

/** mDNS 服务名（局域网发现，bonjour 广播/浏览共用） */
export const MDNS_SERVICE_TYPE = '_agentmesh._tcp' as const;

/** 设备心跳间隔（毫秒），设备守护每 10s 上报一次 */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** 心跳超时阈值（毫秒），超过 30s 未心跳判定离线（P0-8） */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

/** 协调服务（后端）HTTP + WS 同端口 */
export const BACKEND_PORT = 4173;

/** 云端中继默认端口 */
export const RELAY_PORT = 4174;

/** 微信网关默认端口 */
export const WECHAT_PORT = 4175;

/** 协议版本 */
export const PROTOCOL_VERSION = 1;

/** 任务默认最大轮次 */
export const DEFAULT_MAX_TURNS = 50;

/** 任务默认超时（毫秒），10 分钟 */
export const DEFAULT_TIMEOUT_MS = 600_000;

/** 看板全量快照最近任务窗口大小 */
export const SNAPSHOT_TASK_WINDOW = 50;

/** 配对码长度（位） */
export const PAIR_CODE_LENGTH = 6;

/** 配对码默认 TTL（毫秒），5 分钟 */
export const PAIR_CODE_TTL_MS = 300_000;

/** 节点/连线数量聚合阈值（神经图降级聚合） */
export const GRAPH_AGGREGATION_THRESHOLD = 300;

/** 前端 WS 重连基础间隔（毫秒） */
export const WS_RECONNECT_BASE_MS = 1_000;

/** 前端 WS 重连最大间隔（毫秒） */
export const WS_RECONNECT_MAX_MS = 15_000;

/** 参与方固定标识 */
export const ACTOR_COORDINATOR = 'coordinator';
export const ACTOR_DASHBOARD = 'dashboard';
export const ACTOR_WECHAT = 'wechat';

/** 设备本地持久化目录（相对 home） */
export const DEVICE_DATA_DIR = '~/.agentmesh';

/** 后端 SQLite 数据目录 */
export const BACKEND_DATA_DIR = './data';

/** 后端 SQLite 数据库文件名 */
export const BACKEND_DB_FILE = 'agentmesh.db';
