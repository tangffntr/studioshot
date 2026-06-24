/**
 * server/db/client.ts — DB 初始化（better-sqlite3 + drizzle，WAL 模式）
 * 参考 opencode database.ts:22-37 的 WAL 配置。
 */
import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import * as path from "node:path";
import * as fs from "node:fs";

export type DB = BetterSQLite3Database<typeof schema>;

let _db: DB | null = null;
let _raw: Database.Database | null = null;

/** DB 文件路径（data/ 下）
 *  生产环境用 data/app.sqlite；测试可通过 DB_PATH 环境变量重定向到独立库，避免污染生产数据。
 */
function dbPath(): string {
  const override = process.env.DB_PATH;
  if (override) return override;
  const dir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "app.sqlite");
}

/** 获取 drizzle 实例（单例） */
export function getDb(): DB {
  if (_db) return _db;
  const dbFile = dbPath();
  _raw = new Database(dbFile);
  // WAL 模式提升并发读写（opencode 同款配置）
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("synchronous = NORMAL");
  _raw.pragma("busy_timeout = 5000");
  _db = drizzle(_raw, { schema });
  return _db;
}

/** 获取底层 better-sqlite3 实例（建表用） */
export function getRaw(): Database.Database {
  if (!_raw) getDb();
  return _raw!;
}

/** 关闭并重置 DB 单例（仅供测试隔离使用：切换到不同的 DB 文件）。
 *  生产代码请勿调用。
 */
export function __resetDbForTests(): void {
  try { _raw?.close(); } catch { /* 忽略关闭错误 */ }
  _db = null;
  _raw = null;
}

/** 建表（幂等，启动时调用） */
export function initSchema(): void {
  const raw = getRaw();
  raw.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT,
      attributes TEXT, selling_points TEXT, brand_kit_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, asset_id TEXT, product_id TEXT, type TEXT NOT NULL,
      file_path TEXT NOT NULL, thumb_path TEXT, model_id TEXT, prompt_text TEXT,
      params TEXT, gen_state TEXT NOT NULL DEFAULT 'queued', error_reason TEXT,
      cost INTEGER, width INTEGER, height INTEGER, duration INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, product_id TEXT, type TEXT NOT NULL, instruction TEXT NOT NULL,
      payload TEXT, status TEXT NOT NULL DEFAULT 'queued', progress INTEGER NOT NULL DEFAULT 0,
      result TEXT, error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS api_calls (
      id TEXT PRIMARY KEY, job_id TEXT, model_id TEXT, vendor_id TEXT,
      request_summary TEXT, duration_ms INTEGER, cost INTEGER,
      status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      adapter TEXT NOT NULL, base_url TEXT, inputs TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendor_credentials (
      vendor_id TEXT PRIMARY KEY, values_enc TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY, vendor_id TEXT NOT NULL, model_name TEXT NOT NULL,
      display_name TEXT, type TEXT NOT NULL, modes TEXT, pricing TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS task_slots (
      slot_key TEXT PRIMARY KEY, model_id TEXT, params TEXT
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      platform TEXT, product_category TEXT, description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template_slots (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, slot_code TEXT NOT NULL,
      purpose TEXT NOT NULL, sequence INTEGER NOT NULL, scene_type TEXT,
      size_preset TEXT, task_slot_key TEXT NOT NULL, prompt_skeleton TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_specs (
      platform TEXT PRIMARY KEY, hero_size TEXT, detail_size TEXT,
      hero_count INTEGER, rules TEXT, text_render_pref TEXT
    );
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt_text TEXT,
      file_path TEXT, source_media_id TEXT,
      kind TEXT NOT NULL DEFAULT 'image',
      platform TEXT, category TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_product ON media(product_id);
    CREATE INDEX IF NOT EXISTS idx_media_asset ON media(asset_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_product ON jobs(product_id);
    CREATE INDEX IF NOT EXISTS idx_api_calls_job ON api_calls(job_id);
    CREATE INDEX IF NOT EXISTS idx_models_vendor ON models(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_tplslots_template ON template_slots(template_id);
  `);
  // media 表加列（SQLite 不支持 ADD COLUMN IF NOT EXISTS，try-catch 容错）
  migrateAddColumn("media", "slot_code", "TEXT");
  migrateAddColumn("media", "sort_order", "INTEGER");
  migrateAddColumn("media", "job_id", "TEXT");
  // task_slots 表加列（备用模型支持）
  migrateAddColumn("task_slots", "backup_model_id", "TEXT");
  // models 表加列（基础单元格尺寸）
  migrateAddColumn("models", "cell_size", "INTEGER");
  // job_id 列加完后再建索引
  try { getRaw().exec("CREATE INDEX IF NOT EXISTS idx_media_job ON media(job_id)"); } catch {}
}

/** 安全加列：已存在则忽略（SQLite ADD COLUMN 无 IF NOT EXISTS） */
function migrateAddColumn(table: string, column: string, type: string): void {
  try {
    getRaw().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // 列已存在，忽略
  }
}
