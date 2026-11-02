import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 全局单例数据库连接（同步 better-sqlite3） */
let db: Database.Database | null = null;

/**
 * 初始化数据库：确保目录存在 + 建表。
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8',
  );
  db.exec(schema);
  runMigrations(db);
  return db;
}

/**
 * 轻量迁移：对既有数据库补齐 schema.sql 新增列（SQLite 的 CREATE IF NOT EXISTS
 * 不会修改已存在的表，需手动 ALTER）。
 */
function runMigrations(database: Database.Database): void {
  const taskCols = (
    database.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!taskCols.includes('target_role')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN target_role TEXT`);
  }
  if (!taskCols.includes('target_team_id')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN target_team_id TEXT`);
  }
  if (!taskCols.includes('agent_profile')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN agent_profile TEXT`);
  }
  if (!taskCols.includes('target_role_team_id')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN target_role_team_id TEXT`);
  }
  if (!taskCols.includes('target_sub_role')) {
    database.exec(`ALTER TABLE tasks ADD COLUMN target_sub_role TEXT`);
  }

  const deviceCols = (
    database.prepare(`PRAGMA table_info(devices)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!deviceCols.includes('primary_agent_type')) {
    database.exec(`ALTER TABLE devices ADD COLUMN primary_agent_type TEXT`);
  }
  if (!deviceCols.includes('team_id')) {
    database.exec(`ALTER TABLE devices ADD COLUMN team_id TEXT`);
  }
  if (!deviceCols.includes('role_team_id')) {
    database.exec(`ALTER TABLE devices ADD COLUMN role_team_id TEXT`);
  }
  if (!deviceCols.includes('sub_role_bindings')) {
    database.exec(`ALTER TABLE devices ADD COLUMN sub_role_bindings TEXT NOT NULL DEFAULT '{}'`);
  }

  const teamCols = (
    database.prepare(`PRAGMA table_info(teams)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!teamCols.includes('description')) {
    database.exec(`ALTER TABLE teams ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
  }
  if (!teamCols.includes('purpose')) {
    database.exec(`ALTER TABLE teams ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general'`);
  }

  const batchCols = (
    database.prepare(`PRAGMA table_info(deployment_batches)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!batchCols.includes('kind')) {
    database.exec(`ALTER TABLE deployment_batches ADD COLUMN kind TEXT NOT NULL DEFAULT 'deploy'`);
  }

  // 索引必须在列补齐之后创建：老库 schema.sql 里的 CREATE INDEX 会因缺列而失败
  database.exec(`CREATE INDEX IF NOT EXISTS idx_devices_team ON devices (team_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_deployment_batches_kind ON deployment_batches (kind)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_devices_role_team ON devices (role_team_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_role_team ON tasks (target_role_team_id)`);

  // deployment_targets 新增列（SSH 端口 / 设备绑定 / 模型配置）
  const targetCols = (
    database.prepare(`PRAGMA table_info(deployment_targets)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!targetCols.includes('port')) {
    database.exec(`ALTER TABLE deployment_targets ADD COLUMN port INTEGER NOT NULL DEFAULT 22`);
  }
  if (!targetCols.includes('device_id')) {
    database.exec(`ALTER TABLE deployment_targets ADD COLUMN device_id TEXT`);
  }
  if (!targetCols.includes('model_configs')) {
    database.exec(`ALTER TABLE deployment_targets ADD COLUMN model_configs TEXT NOT NULL DEFAULT '[]'`);
  }

  // agents 新增列 activated（存量默认 1=已激活，避免升级后既有 agent 突然不可用）
  const agentCols = (
    database.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!agentCols.includes('activated')) {
    database.exec(`ALTER TABLE agents ADD COLUMN activated INTEGER NOT NULL DEFAULT 1`);
  }
  if (!agentCols.includes('bots')) {
    database.exec(`ALTER TABLE agents ADD COLUMN bots TEXT NOT NULL DEFAULT '[]'`);
  }
}

/** 获取数据库实例（未初始化则先初始化） */
export function getDb(): Database.Database {
  if (!db) return initDatabase();
  return db;
}

/** 关闭数据库（进程退出时调用） */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
