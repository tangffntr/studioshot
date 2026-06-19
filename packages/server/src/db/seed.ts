/**
 * server/db/seed.ts — 默认数据 seed（首次启动初始化）
 * 从 .env 读凭证，建立 grsai（生图）+ orchestrator（主 LLM）+ vlm（看图）供应商与模型绑定。
 * 幂等：已存在则跳过。
 */
import { getDb, getRaw } from "./client";
import { vendors, vendorCredentials, models, taskSlots } from "./schema";
import { eq } from "drizzle-orm";
import { encryptCredentials } from "../model-manager/credentials";

export function seedDefaults(): void {
  const db = getDb();
  const now = Date.now();

  function upsertVendor(id: string, name: string, category: string, adapter: string, baseUrl: string | null, inputs: object) {
    const exists = db.select().from(vendors).where(eq(vendors.id, id)).all()[0];
    if (exists) return;
    db.insert(vendors).values({ id, name, category, adapter, baseUrl, inputs: JSON.stringify(inputs), createdAt: now }).run();
  }
  function upsertCred(vendorId: string, values: Record<string, string>) {
    const exists = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, vendorId)).all()[0];
    if (exists) {
      db.update(vendorCredentials).set({ valuesEnc: encryptCredentials(values), updatedAt: now }).where(eq(vendorCredentials.vendorId, vendorId)).run();
    } else {
      db.insert(vendorCredentials).values({ vendorId, valuesEnc: encryptCredentials(values), enabled: 1, updatedAt: now }).run();
    }
  }
  function upsertModel(id: string, vendorId: string, modelName: string, displayName: string, type: string, modes: string[]) {
    const exists = db.select().from(models).where(eq(models.id, id)).all()[0];
    if (exists) return;
    db.insert(models).values({
      id, vendorId, modelName, displayName, type,
      modes: JSON.stringify(modes), pricing: JSON.stringify({ unit: "per-call", price: 50 }), enabled: 1,
    }).run();
  }
  function upsertSlot(slotKey: string, modelId: string) {
    const exists = db.select().from(taskSlots).where(eq(taskSlots.slotKey, slotKey)).all()[0];
    if (exists) {
      db.update(taskSlots).set({ modelId }).where(eq(taskSlots.slotKey, slotKey)).run();
    } else {
      db.insert(taskSlots).values({ slotKey, modelId, params: null }).run();
    }
  }

  const passwordInput = { key: "apiKey", label: "API Key", type: "password" as const, required: true };

  // 1. grsai 生图（gpt-image-2）
  upsertVendor("grsai", "Grsai (gpt-image-2)", "image", "grsai", process.env.OPENAI_BASE_URL || "https://grsai.dakka.com.cn", [passwordInput]);
  if (process.env.OPENAI_API_KEY) {
    upsertCred("grsai", { apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || "https://grsai.dakka.com.cn" });
  }
  upsertModel("grsai:gpt-image-2", "grsai", "gpt-image-2", "GPT Image 2", "image", ["text", "singleImage", "multiReference"]);
  upsertSlot("main-image", "grsai:gpt-image-2");

  // 2. orchestrator 主推理 LLM（MiMo-V2.5 全模态，支持图片输入）
  // 注意：mimo-v2.5 是全模态；mimo-v2.5-pro 是纯文本（不支持图片）
  const orchModel = process.env.ORCHESTRATOR_MODEL || "mimo-v2.5";
  upsertVendor("orchestrator", "主推理 LLM", "vlm", "openai-chat", process.env.ORCHESTRATOR_BASE_URL || null, [passwordInput]);
  if (process.env.ORCHESTRATOR_API_KEY) {
    upsertCred("orchestrator", { apiKey: process.env.ORCHESTRATOR_API_KEY, baseUrl: process.env.ORCHESTRATOR_BASE_URL || "" });
  }
  upsertModel(`orchestrator:${orchModel}`, "orchestrator", orchModel, "主推理（全模态）", "vlm", ["text", "image"]);
  upsertSlot("orchestrator", `orchestrator:${orchModel}`);

  // 3. vlm 看图分析（复用 orchestrator 端点）
  upsertSlot("vlm", `orchestrator:${orchModel}`);

  // 确保表已建
  void getRaw;
}
