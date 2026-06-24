/**
 * @ecom/shared — 领域类型（对应数据模型 §4 的表结构，TS 类型层）
 * Zod schema 在 schemas/ 下，类型从这里导出供前后端共用。
 */
import type { EventType, JobStatus, GenState, TaskSlot, MediaType, VendorCategory } from "./constants";

/** 媒体（物理媒体：图片/视频，含生成状态机 + prompt 留痕） */
export interface Media {
  id: string;
  assetId: string | null;
  productId: string | null;
  type: MediaType;
  filePath: string; // OSS 路径 /{productId}/{type}/{uuid}.ext
  thumbPath: string | null;
  modelId: string | null;
  promptText: string | null; // ⭐ 留痕：用什么 prompt 生成
  params: Record<string, unknown> | null;
  genState: GenState;
  errorReason: string | null;
  cost: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: number;
}

/** 产品 */
export interface Product {
  id: string;
  name: string;
  category: string | null;
  attributes: Record<string, unknown> | null; // VLM 分析出的 SKU 属性
  sellingPoints: Record<string, unknown> | null;
  brandKitId: string | null;
  createdAt: number;
}

/** Job（异步任务，admit-then-run） */
export interface Job {
  id: string;
  productId: string | null;
  type: string; // "single-image" | "analyze" | ...
  instruction: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  progress: number; // 0-100
  result: { mediaIds?: string[] } | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** API 调用审计（计费） */
export interface ApiCall {
  id: string;
  jobId: string | null;
  modelId: string | null;
  vendorId: string | null;
  requestSummary: string | null;
  durationMs: number | null;
  cost: number | null;
  status: string; // "success" | "failed"
  error: string | null;
  createdAt: number;
}

/** 供应商 */
export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  adapter: string; // 适配器标识（指向受控代码）
  baseUrl: string | null;
  inputs: VendorInput[]; // 凭证字段定义
  createdAt: number;
}
export interface VendorInput {
  key: string;
  label: string;
  type: "password" | "text";
  required: boolean;
}

/** 模型 */
export interface Model {
  id: string; // "grsai:gpt-image-2"
  vendorId: string;
  modelName: string; // API 实际模型名 "gpt-image-2"
  displayName: string | null;
  type: VendorCategory;
  modes: string[]; // ["text","singleImage","multiReference"]
  pricing: { unit: string; price: number } | null;
  enabled: boolean;
  cellSize: number; // 基础单元格尺寸（1024=1k, 2048=2k, 4096=4k）
}

/** 任务槽绑定（支持主/备用模型） */
export interface TaskSlotBinding {
  slotKey: TaskSlot;
  modelId: string | null;
  backupModelId: string | null; // 备用模型（主模型失败时 fallback）
  params: Record<string, unknown> | null;
}

// ---------- 模板套图类型 ----------
/** 模板主记录 */
export interface Template {
  id: string;
  name: string;
  category: string;
  platform: string | null;
  productCategory: string | null;
  description: string | null;
  isBuiltin: boolean;
  slotCount?: number; // 列表接口附带
}

/** 模板图位 */
export interface TemplateSlot {
  id: string;
  templateId: string;
  slotCode: string;
  purpose: string;
  sequence: number;
  sceneType: string | null;
  sizePreset: string | null;
  taskSlotKey: string;
  promptSkeleton: string;
  required: boolean;
  notes: string | null;
}

/** 模板详情（含图位） */
export interface TemplateDetail extends Template {
  slots: TemplateSlot[];
}

// ---------- SSE 事件 payload 类型 ----------
export interface SseEvent {
  type: EventType;
  jobId?: string;
  // 各类型 payload
  progress?: number;
  message?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  mediaId?: string;
  thumbUrl?: string;
  url?: string;
  text?: string;
  resultMediaIds?: string[];
  error?: string;
}
