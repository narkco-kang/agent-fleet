-- AgentFleet SQLite 建表 DDL
-- 基础 5 张表（devices/agents/tasks/messages/sessions）+ 路由网关融合新增 11 张表
-- （role_routes/assets/asset_deliveries/teams/loops/deployment_batches/
--   deployment_targets/action_confirmations/usage_records/platform_models/free_checkins）。
-- 所有时间戳为 epoch 毫秒（INTEGER）。

CREATE TABLE IF NOT EXISTS devices (
  device_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  hostname       TEXT NOT NULL DEFAULT '',
  os_platform    TEXT NOT NULL DEFAULT '',
  os_arch        TEXT NOT NULL DEFAULT '',
  daemon_version TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'offline',
  last_heartbeat INTEGER,
  lan_addr       TEXT,
  relay_online   INTEGER NOT NULL DEFAULT 0,
  token          TEXT NOT NULL DEFAULT '',
  owner          TEXT NOT NULL DEFAULT 'default',
  primary_agent_type TEXT,
  team_id        TEXT,                       -- 该设备绑定的团队（团队模式路由）
  created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id       TEXT NOT NULL,
  agent_type      TEXT NOT NULL,
  display_name    TEXT NOT NULL DEFAULT '',
  version         TEXT NOT NULL DEFAULT '',
  executable      TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'available',
  capabilities    TEXT NOT NULL DEFAULT '[]',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  busy_count      INTEGER NOT NULL DEFAULT 0,
  activated       INTEGER NOT NULL DEFAULT 0,  -- 1=已登录激活；0=需登录激活
  bots            TEXT NOT NULL DEFAULT '[]',  -- 平台内可选 bot 列表 JSON（如 grok 自定义 agent）
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  UNIQUE (device_id, agent_type)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id  TEXT PRIMARY KEY,
  origin      TEXT NOT NULL DEFAULT 'dashboard',
  origin_ref  TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id            TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  origin             TEXT NOT NULL DEFAULT 'dashboard',
  origin_ref         TEXT NOT NULL DEFAULT '',
  prompt             TEXT NOT NULL DEFAULT '',
  target_mode        TEXT NOT NULL DEFAULT 'auto',
  target_device_id   TEXT,
  target_agent_type  TEXT,
  target_role        TEXT,
  target_team_id     TEXT,
  require_capability TEXT,
  agent_profile      TEXT,
  status             TEXT NOT NULL DEFAULT 'queued',
  result_text        TEXT,
  exit_code          INTEGER,
  error              TEXT,
  duration_ms        INTEGER,
  tokens_in          INTEGER,
  tokens_out         INTEGER,
  created_at         INTEGER NOT NULL,
  started_at         INTEGER,
  finished_at        INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  status     TEXT,
  data       TEXT NOT NULL DEFAULT '{}',
  ts         INTEGER NOT NULL
);

-- ===== 路由网关融合新增表 =====

CREATE TABLE IF NOT EXISTS role_routes (
  role          TEXT PRIMARY KEY,
  primary_ref   TEXT NOT NULL,
  fallback_refs TEXT NOT NULL DEFAULT '[]',   -- JSON array
  capability    TEXT NOT NULL DEFAULT 'chat',
  bots          TEXT NOT NULL DEFAULT '[]',   -- JSON array
  device_id     TEXT,
  agent_type    TEXT,
  model         TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id     TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                 -- rule|knowledge|skill
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',      -- 概述/注释（显示在列表）
  description_zh TEXT NOT NULL DEFAULT '',    -- 概述中文翻译
  source       TEXT NOT NULL DEFAULT 'manual',-- manual|github|imported
  content      TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'text',  -- text|file
  version      INTEGER NOT NULL DEFAULT 1,
  tags         TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_deliveries (
  delivery_id   TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL,
  asset_version INTEGER NOT NULL,
  device_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|confirmed|sending|delivered|failed
  error         TEXT,
  created_at    INTEGER NOT NULL,
  delivered_at  INTEGER
);

CREATE TABLE IF NOT EXISTS teams (
  team_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  purpose     TEXT NOT NULL DEFAULT 'general', -- software|content|research|ops|general
  members     TEXT NOT NULL DEFAULT '[]',      -- JSON array
  routes      TEXT NOT NULL DEFAULT '{}',      -- JSON object
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loops (
  loop_id            TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  steps              TEXT NOT NULL DEFAULT '[]',  -- JSON array
  trigger            TEXT NOT NULL DEFAULT 'manual',
  targets            TEXT NOT NULL DEFAULT '[]',
  state              TEXT NOT NULL DEFAULT 'idle',
  current_round      INTEGER NOT NULL DEFAULT 0,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_batches (
  batch_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'deploy',   -- deploy|uninstall
  status     TEXT NOT NULL DEFAULT 'pending_confirmation',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_targets (   -- 无密码列（安全红线）
  target_id  TEXT PRIMARY KEY,
  batch_id   TEXT NOT NULL,
  ip         TEXT NOT NULL,
  user       TEXT NOT NULL,
  port       INTEGER NOT NULL DEFAULT 22,
  device_id  TEXT,                              -- 可选：已注册 AgentFleet 设备 id
  os         TEXT NOT NULL DEFAULT 'unknown',
  platforms  TEXT NOT NULL DEFAULT '[]',
  model_configs TEXT NOT NULL DEFAULT '[]',     -- JSON: PlatformModelConfig[]
  status     TEXT NOT NULL DEFAULT 'pending',
  error      TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS action_confirmations (
  confirmation_id TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,                 -- deploy|asset_deliver|loop_start
  ref_id          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_confirmation',
  payload_summary TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  confirmed_at    INTEGER,
  confirmed_by    TEXT
);

CREATE TABLE IF NOT EXISTS usage_records (
  record_id   TEXT PRIMARY KEY,
  task_id     TEXT,
  provider    TEXT,
  model       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  created_at  INTEGER NOT NULL
);

-- 平台模型绑定：device + agent → 网关模型（部署完成即用 / 故障切换）
CREATE TABLE IF NOT EXISTS platform_models (
  device_id    TEXT NOT NULL,
  agent_type   TEXT NOT NULL,
  model        TEXT NOT NULL,
  fallbacks    TEXT NOT NULL DEFAULT '[]',
  active_model TEXT NOT NULL,
  excluded     TEXT NOT NULL DEFAULT '[]',      -- 已失败待排除模型
  state        TEXT NOT NULL DEFAULT 'ok',      -- ok|degraded
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (device_id, agent_type)
);

-- 免费源自动签到审计
CREATE TABLE IF NOT EXISTS free_checkins (
  checkin_id TEXT PRIMARY KEY,
  source_id  TEXT NOT NULL,
  status     TEXT NOT NULL,                     -- ok|failed
  detail     TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL
);

-- ===== 蜂群角色团队（swarm） =====

-- 角色团队：一个团队包含若干子角色（子角色事实源为 sub_roles 表）。
CREATE TABLE IF NOT EXISTS role_teams (
  role_team_id TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,            -- 全局唯一 [a-z0-9-]
  description  TEXT NOT NULL DEFAULT '',
  purpose      TEXT NOT NULL DEFAULT 'general', -- software|content|security|research|general
  sub_roles    TEXT NOT NULL DEFAULT '[]',      -- 有序子角色 slug JSON 数组（冗余）
  version      INTEGER NOT NULL DEFAULT 1,
  is_preset    INTEGER NOT NULL DEFAULT 0,      -- 1=预设；0=用户创建
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 子角色：persona + operation 存 JSON，软绑定三级决策依据。
CREATE TABLE IF NOT EXISTS sub_roles (
  sub_role_id          TEXT PRIMARY KEY,
  role_team_id         TEXT NOT NULL,
  slug                 TEXT NOT NULL,           -- [a-z0-9-]，团队内唯一
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  capabilities         TEXT NOT NULL DEFAULT '[]',      -- JSON string[]
  persona              TEXT NOT NULL DEFAULT '{}',      -- JSON SubRolePersona
  operation            TEXT NOT NULL DEFAULT '{}',      -- JSON SubRoleOperation
  preferred_agent_type TEXT,                           -- AgentType | null
  required_capabilities TEXT NOT NULL DEFAULT '[]',    -- JSON string[]
  position             INTEGER NOT NULL DEFAULT 0,
  UNIQUE (role_team_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_agents_device ON agents (device_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_origin_ref ON tasks (origin_ref);
CREATE INDEX IF NOT EXISTS idx_messages_task_seq ON messages (task_id, seq);
CREATE INDEX IF NOT EXISTS idx_asset_deliveries_device ON asset_deliveries (device_id);
CREATE INDEX IF NOT EXISTS idx_asset_deliveries_status ON asset_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_deployment_targets_batch ON deployment_targets (batch_id);
CREATE INDEX IF NOT EXISTS idx_free_checkins_source ON free_checkins (source_id);
CREATE INDEX IF NOT EXISTS idx_free_checkins_at ON free_checkins (checked_at);
CREATE INDEX IF NOT EXISTS idx_action_confirmations_ref ON action_confirmations (kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_task ON usage_records (task_id);
CREATE INDEX IF NOT EXISTS idx_role_teams_slug ON role_teams (slug);
CREATE INDEX IF NOT EXISTS idx_sub_roles_team ON sub_roles (role_team_id);

-- 任务级上下文交接摘要（P0-3）：同 session 下一任务注入前序摘要，沿任务链有界累积
CREATE TABLE IF NOT EXISTS task_contexts (
  task_id     TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  token_count INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_contexts_session ON task_contexts (session_id, updated_at);
