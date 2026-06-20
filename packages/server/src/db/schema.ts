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
  jobId: text("job_id"), // ⭐ 关联产出 job（右侧栏按 job 过滤）
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
  slotCode: text("slot_code"), // ⭐ 模板图位（H1/D3...），模板套图用
  sortOrder: integer("sort_order"), // ⭐ 套图内序号
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

/** 模板主表（可行性报告 §6.2） */
export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // pdp|hero-only|social|tryon|seasonal|scene-swap
  platform: text("platform"), // amazon|taobao|jd|douyin|shopify|null
  productCategory: text("product_category"), // 服饰|3C|美妆|null
  description: text("description"),
  isBuiltin: integer("is_builtin").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 模板图位（图片序列定义）⭐ 核心 */
export const templateSlots = sqliteTable("template_slots", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  slotCode: text("slot_code").notNull(), // H1|D3|M1
  purpose: text("purpose").notNull(), // 首图卖点|痛点放大
  sequence: integer("sequence").notNull(),
  sceneType: text("scene_type"), // hero|lifestyle|infographic|before-after
  sizePreset: text("size_preset"), // 1024x1024|1024x1536
  taskSlotKey: text("task_slot_key").notNull(), // 关联 task_slots（路由到生图模型）
  promptSkeleton: text("prompt_skeleton").notNull(), // 含 {color} 等占位的骨架
  required: integer("required").notNull().default(1),
  notes: text("notes"), // 出图注意事项
});

/** 平台尺寸与规则 */
export const platformSpecs = sqliteTable("platform_specs", {
  platform: text("platform").primaryKey(),
  heroSize: text("hero_size"),
  detailSize: text("detail_size"),
  heroCount: integer("hero_count"),
  rules: text("rules"), // JSON
  textRenderPref: text("text_render_pref"), // 中文|英文
});

/** 素材库（可复用：用户从资产转存，或手动添加） */
export const materials = sqliteTable("materials", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  promptText: text("prompt_text"),
  filePath: text("file_path").notNull(),
  sourceMediaId: text("source_media_id"), // 从哪个 media 转存
  kind: text("kind").notNull().default("image"), // image | scene-ref
  createdAt: integer("created_at").notNull(),
});

export type DbProduct = typeof products.$inferSelect;
export type DbMedia = typeof media.$inferSelect;
export type DbJob = typeof jobs.$inferSelect;
export type DbApiCall = typeof apiCalls.$inferSelect;
export type DbVendor = typeof vendors.$inferSelect;
export type DbVendorCredential = typeof vendorCredentials.$inferSelect;
export type DbModel = typeof models.$inferSelect;
export type DbTaskSlot = typeof taskSlots.$inferSelect;
export type DbTemplate = typeof templates.$inferSelect;
export type DbTemplateSlot = typeof templateSlots.$inferSelect;
export type DbPlatformSpec = typeof platformSpecs.$inferSelect;
export type DbMaterial = typeof materials.$inferSelect;
