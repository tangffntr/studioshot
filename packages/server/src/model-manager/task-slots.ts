/**
 * server/model-manager/task-slots.ts — 任务槽解析
 * slotKey → modelId（查 task_slots 表）→ vendorId + modelName（查 models 表）
 * 对应 Toonflow resolveModelName + getModelConfig。
 */
import { getDb } from "../db/client";
import { models, taskSlots, vendors } from "../db/schema";
import { eq } from "drizzle-orm";

export interface ResolvedModel {
  modelId: string;
  vendorId: string;
  adapter: string; // ⭐ 适配器标识（如 openai-chat/grsai），用于查 registry
  modelName: string; // API 实际模型名
  baseUrl: string | null;
}

/** 解析单个模型 ID → 模型信息（内部辅助） */
function resolveModelId(modelId: string): ResolvedModel {
  const db = getDb();
  const model = db.select().from(models).where(eq(models.id, modelId)).all()[0];
  if (!model) throw new Error(`模型 ${modelId} 不存在`);
  const vendor = db.select().from(vendors).where(eq(vendors.id, model.vendorId)).all()[0];
  if (!vendor) throw new Error(`供应商 ${model.vendorId} 不存在`);
  return {
    modelId: model.id,
    vendorId: vendor.id,
    adapter: vendor.adapter,
    modelName: model.modelName,
    baseUrl: vendor.baseUrl,
  };
}

/** 解析任务槽 → 主模型信息 */
export function resolveSlot(slotKey: string): ResolvedModel {
  const db = getDb();
  const slot = db.select().from(taskSlots).where(eq(taskSlots.slotKey, slotKey)).all()[0];
  if (!slot?.modelId) throw new Error(`任务槽 ${slotKey} 未绑定模型`);
  return resolveModelId(slot.modelId);
}

/** 解析任务槽 → 主模型 + 备用模型（备用可为 null） */
export function resolveSlotWithBackup(slotKey: string): { primary: ResolvedModel; backup: ResolvedModel | null } {
  const db = getDb();
  const slot = db.select().from(taskSlots).where(eq(taskSlots.slotKey, slotKey)).all()[0];
  if (!slot?.modelId) throw new Error(`任务槽 ${slotKey} 未绑定模型`);
  const primary = resolveModelId(slot.modelId);
  let backup: ResolvedModel | null = null;
  if (slot.backupModelId) {
    try { backup = resolveModelId(slot.backupModelId); } catch { backup = null; }
  }
  return { primary, backup };
}
