-- AgentMesh SQLite 建表 DDL
-- 基础 5 张表（devices/agents/tasks/messages/sessions）+ 路由网关融合新增 9 张表
-- （role_routes/assets/asset_deliveries/teams/loops/deployment_batches/
--   deployment_targets/action_confirmations/usage_records）。
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
  require_capability TEXT,
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
  team_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  members    TEXT NOT NULL DEFAULT '[]',      -- JSON array
  routes     TEXT NOT NULL DEFAULT '{}',      -- JSON object
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  status     TEXT NOT NULL DEFAULT 'pending_confirmation',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_targets (   -- 无密码列（安全红线）
  target_id  TEXT PRIMARY KEY,
  batch_id   TEXT NOT NULL,
  ip         TEXT NOT NULL,
  user       TEXT NOT NULL,
  os         TEXT NOT NULL DEFAULT 'unknown',
  platforms  TEXT NOT NULL DEFAULT '[]',
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

CREATE INDEX IF NOT EXISTS idx_agents_device ON agents (device_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_origin_ref ON tasks (origin_ref);
CREATE INDEX IF NOT EXISTS idx_messages_task_seq ON messages (task_id, seq);
CREATE INDEX IF NOT EXISTS idx_asset_deliveries_device ON asset_deliveries (device_id);
CREATE INDEX IF NOT EXISTS idx_asset_deliveries_status ON asset_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_deployment_targets_batch ON deployment_targets (batch_id);
CREATE INDEX IF NOT EXISTS idx_action_confirmations_ref ON action_confirmations (kind, ref_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_task ON usage_records (task_id);
