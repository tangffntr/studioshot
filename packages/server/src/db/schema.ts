/**
 * server/db/schema.ts — Drizzle schema（8 张 MVP 表）
 * 字段对齐 @ecom/shared types.ts。对应计划 §4。
 * SQLite：时间戳用 integer(ms)，JSON 用 text。
 */
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** 产品库 */
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  attributes: text("attributes"), // JSON
  sellingPoints: text("selling_points"), // JSON
  brandKitId: text("brand_kit_id"),
  createdAt: integer("created_at").notNull(),
});

/** 物理媒体（图片/视频，含生成状态机 + prompt 留痕） */
export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  assetId: text("asset_id"),
  productId: text("product_id"),
  type: text("type").notNull(), // image | video
  filePath: text("file_path").notNull(),
  thumbPath: text("thumb_path"),
  modelId: text("model_id"),
  promptText: text("prompt_text"), // ⭐ 留痕
  params: text("params"), // JSON
  genState: text("gen_state").notNull().default("queued"),
  errorReason: text("error_reason"),
  cost: integer("cost"),
  width: integer("width"),
  height: integer("height"),
  duration: integer("duration"),
  createdAt: integer("created_at").notNull(),
});

/** Job（异步任务，admit-then-run） */
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  productId: text("product_id"),
  type: text("type").notNull(),
  instruction: text("instruction").notNull(),
  payload: text("payload"), // JSON
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  result: text("result"), // JSON
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

/** API 调用审计（计费） */
export const apiCalls = sqliteTable("api_calls", {
  id: text("id").primaryKey(),
  jobId: text("job_id"),
  modelId: text("model_id"),
  vendorId: text("vendor_id"),
  requestSummary: text("request_summary"),
  durationMs: integer("duration_ms"),
  cost: integer("cost"),
  status: text("status").notNull(), // success | failed
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

/** 供应商注册表 */
export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // image|video|tryon|vlm|matting
  adapter: text("adapter").notNull(),
  baseUrl: text("base_url"),
  inputs: text("inputs").notNull(), // JSON: 凭证字段定义
  createdAt: integer("created_at").notNull(),
});

/** 供应商凭证（加密存储） */
export const vendorCredentials = sqliteTable("vendor_credentials", {
  vendorId: text("vendor_id").primaryKey(),
  valuesEnc: text("values_enc").notNull(), // AES 加密的 JSON
  enabled: integer("enabled").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

/** 模型目录 */
export const models = sqliteTable("models", {
  id: text("id").primaryKey(), // "grsai:gpt-image-2"
  vendorId: text("vendor_id").notNull(),
  modelName: text("model_name").notNull(),
  displayName: text("display_name"),
  type: text("type").notNull(),
  modes: text("modes"), // JSON
  pricing: text("pricing"), // JSON
  enabled: integer("enabled").notNull().default(1),
});

/** 任务槽（模型绑定） */
export const taskSlots = sqliteTable("task_slots", {
  slotKey: text("slot_key").primaryKey(),
  modelId: text("model_id"),
  params: text("params"), // JSON
});

export type DbProduct = typeof products.$inferSelect;
export type DbMedia = typeof media.$inferSelect;
export type DbJob = typeof jobs.$inferSelect;
export type DbApiCall = typeof apiCalls.$inferSelect;
export type DbVendor = typeof vendors.$inferSelect;
export type DbVendorCredential = typeof vendorCredentials.$inferSelect;
export type DbModel = typeof models.$inferSelect;
export type DbTaskSlot = typeof taskSlots.$inferSelect;
