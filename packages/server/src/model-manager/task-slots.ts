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

/** 解析任务槽 → 模型信息 */
export function resolveSlot(slotKey: string): ResolvedModel {
  const db = getDb();
  const slot = db.select().from(taskSlots).where(eq(taskSlots.slotKey, slotKey)).all()[0];
  if (!slot?.modelId) throw new Error(`任务槽 ${slotKey} 未绑定模型`);
  const model = db.select().from(models).where(eq(models.id, slot.modelId)).all()[0];
  if (!model) throw new Error(`模型 ${slot.modelId} 不存在`);
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
