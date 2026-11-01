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

  const deviceCols = (
    database.prepare(`PRAGMA table_info(devices)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  if (!deviceCols.includes('primary_agent_type')) {
    database.exec(`ALTER TABLE devices ADD COLUMN primary_agent_type TEXT`);
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
