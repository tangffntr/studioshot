import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resolveSlot } from "./task-slots";
import { getDb, getRaw, initSchema } from "../db/client";
import { vendors, vendorCredentials, models, taskSlots } from "../db/schema";
import { encryptCredentials } from "./credentials";

beforeAll(() => initSchema());

beforeEach(() => {
  const raw = getRaw();
  for (const t of ["products", "media", "jobs", "api_calls", "vendors", "vendor_credentials", "models", "task_slots"]) {
    raw.exec(`DELETE FROM ${t}`);
  }
  // seed: grsai 供应商 + 凭证 + 模型 + 任务槽
  const db = getDb();
  db.insert(vendors).values({
    id: "grsai", name: "Grsai", category: "image", adapter: "grsai",
    baseUrl: "https://grsai.dakka.com.cn",
    inputs: JSON.stringify([{ key: "apiKey", type: "password", required: true }]),
    createdAt: Date.now(),
  }).run();
  db.insert(vendorCredentials).values({
    vendorId: "grsai", valuesEnc: encryptCredentials({ apiKey: "sk-seed" }), enabled: 1, updatedAt: Date.now(),
  }).run();
  db.insert(models).values({
    id: "grsai:gpt-image-2", vendorId: "grsai", modelName: "gpt-image-2",
    displayName: "GPT Image 2", type: "image", modes: JSON.stringify(["text", "singleImage"]),
    pricing: JSON.stringify({ unit: "per-image", price: 50 }), enabled: 1,
  }).run();
  db.insert(taskSlots).values({ slotKey: "main-image", modelId: "grsai:gpt-image-2", params: null }).run();
});

describe("task-slots 解析", () => {
  it("resolveSlot 返回模型信息", () => {
    const r = resolveSlot("main-image");
    expect(r.modelId).toBe("grsai:gpt-image-2");
    expect(r.vendorId).toBe("grsai");
    expect(r.modelName).toBe("gpt-image-2");
    expect(r.baseUrl).toBe("https://grsai.dakka.com.cn");
  });

  it("未绑定的槽抛错", () => {
    expect(() => resolveSlot("nonexistent")).toThrow("未绑定");
  });
});
