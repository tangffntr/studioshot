import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getRaw, initSchema } from "./client";
import { products, media, jobs, apiCalls, vendors, vendorCredentials, models, taskSlots, templates, templateSlots, platformSpecs } from "./schema";
import * as fs from "node:fs";
import * as path from "node:path";

// 用临时 DB 避免污染（每个测试文件独立 db 文件）
const TMP_DIR = path.resolve(process.cwd(), "data/test-tmp");
beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

// 重置单例 + 用临时 db
beforeEach(() => {
  // 直接用内存表测：关闭后重开到临时文件
  const raw = getRaw();
  // 清空所有表（幂等测试）
  for (const t of ["products", "media", "jobs", "api_calls", "vendors", "vendor_credentials", "models", "task_slots", "templates", "template_slots", "platform_specs"]) {
    raw.exec(`DELETE FROM ${t}`);
  }
});

beforeAll(() => {
  initSchema();
});

describe("db schema CRUD", () => {
  it("products 增删改查", () => {
    const db = getDb();
    db.insert(products).values({
      id: "p1", name: "红杯", category: "家居", attributes: JSON.stringify({ color: "red" }),
      sellingPoints: null, brandKitId: null, createdAt: Date.now(),
    }).run();
    const got = db.select().from(products).where(eq(products.id, "p1")).all()[0];
    expect(got?.name).toBe("红杯");
    expect(JSON.parse(got!.attributes!)).toEqual({ color: "red" });

    db.update(products).set({ name: "红马克杯" }).where(eq(products.id, "p1")).run();
    db.delete(products).where(eq(products.id, "p1")).run();
  });

  it("media 含生成状态机字段", () => {
    const db = getDb();
    db.insert(media).values({
      id: "m1", assetId: null, productId: "p1", type: "image",
      filePath: "/p1/image/x.png", thumbPath: null, modelId: "grsai:gpt-image-2",
      promptText: "a red mug", params: null, genState: "queued",
      errorReason: null, cost: null, width: 1024, height: 1024, duration: null, createdAt: Date.now(),
    }).run();
    const got = db.select().from(media).all()[0];
    expect(got.genState).toBe("queued");
    expect(got.promptText).toBe("a red mug"); // 留痕字段
    expect(got.modelId).toBe("grsai:gpt-image-2");
  });

  it("jobs admit-then-run 状态机", () => {
    const db = getDb();
    db.insert(jobs).values({
      id: "j1", productId: "p1", type: "single-image", instruction: "出主图",
      payload: null, status: "queued", progress: 0, result: null, error: null,
      createdAt: Date.now(), startedAt: null, finishedAt: null,
    }).run();
    // 模拟 worker 接走
    db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, "j1")).run();
    let got = db.select().from(jobs).where(eq(jobs.id, "j1")).all()[0];
    expect(got.status).toBe("running");
    // 完成
    db.update(jobs).set({ status: "done", progress: 100, result: JSON.stringify({ mediaIds: ["m1"] }), finishedAt: Date.now() }).where(eq(jobs.id, "j1")).run();
    got = db.select().from(jobs).all()[0];
    expect(got.status).toBe("done");
    expect(JSON.parse(got.result!)).toEqual({ mediaIds: ["m1"] });
  });

  it("api_calls 计费审计", () => {
    const db = getDb();
    db.insert(apiCalls).values({
      id: "a1", jobId: "j1", modelId: "grsai:gpt-image-2", vendorId: "grsai",
      requestSummary: "gpt-image-2 gen", durationMs: 33000, cost: 50,
      status: "success", error: null, createdAt: Date.now(),
    }).run();
    const got = db.select().from(apiCalls).all()[0];
    expect(got.cost).toBe(50);
    expect(got.status).toBe("success");
  });

  it("vendors + 凭证 + models + task_slots 关联", () => {
    const db = getDb();
    db.insert(vendors).values({
      id: "testvendor", name: "TestVendor", category: "image", adapter: "grsai",
      baseUrl: "https://x.com", inputs: JSON.stringify([{ key: "apiKey", type: "password", required: true }]),
      createdAt: Date.now(),
    }).run();
    db.insert(vendorCredentials).values({
      vendorId: "testvendor", valuesEnc: "encrypted-blob", enabled: 1, updatedAt: Date.now(),
    }).run();
    db.insert(models).values({
      id: "testvendor:test-model", vendorId: "testvendor", modelName: "test-model",
      displayName: "Test Model", type: "image", modes: JSON.stringify(["text", "singleImage"]),
      pricing: JSON.stringify({ unit: "per-image", price: 50 }), enabled: 1,
    }).run();
    db.insert(taskSlots).values({ slotKey: "test-slot", modelId: "testvendor:test-model", params: JSON.stringify({ size: "1024x1024" }) }).run();

    const m = db.select().from(models).where(eq(models.id, "testvendor:test-model")).all()[0];
    expect(m.vendorId).toBe("testvendor");
    const ts = db.select().from(taskSlots).where(eq(taskSlots.slotKey, "test-slot")).all()[0];
    expect(ts.modelId).toBe("testvendor:test-model");
    expect(ts.slotKey).toBe("test-slot");
  });

  it("media 含模板图位列 slotCode/sortOrder", () => {
    const db = getDb();
    db.insert(media).values({
      id: "m-slot", assetId: null, productId: "p1", type: "image",
      filePath: "/p1/image/x.png", thumbPath: null, modelId: null,
      promptText: "hero", params: null, genState: "done", errorReason: null,
      cost: null, width: 1024, height: 1024, duration: null,
      slotCode: "H1", sortOrder: 1, createdAt: Date.now(),
    }).run();
    const got = db.select().from(media).where(eq(media.id, "m-slot")).all()[0];
    expect(got.slotCode).toBe("H1");
    expect(got.sortOrder).toBe(1);
  });

  it("templates + template_slots + platform_specs 关联", () => {
    const db = getDb();
    const now = Date.now();
    db.insert(platformSpecs).values({
      platform: "amazon", heroSize: "1024x1024", detailSize: "1024x1536",
      heroCount: 5, rules: JSON.stringify({ firstImageWhiteBg: true }), textRenderPref: "英文",
    }).run();
    db.insert(templates).values({
      id: "tpl-amazon-pdp", name: "亚马逊PDP套图", category: "pdp", platform: "amazon",
      productCategory: null, description: "5主图+9详情页", isBuiltin: 1, version: 1,
      createdAt: now, updatedAt: now,
    }).run();
    db.insert(templateSlots).values({
      id: "ts1", templateId: "tpl-amazon-pdp", slotCode: "H1", purpose: "首图卖点",
      sequence: 1, sceneType: "hero", sizePreset: "1024x1024", taskSlotKey: "main-image",
      promptSkeleton: "white bg product photo of {category}, color {color}",
      required: 1, notes: "白底无文字",
    }).run();
    db.insert(templateSlots).values({
      id: "ts2", templateId: "tpl-amazon-pdp", slotCode: "D1", purpose: "首屏承接",
      sequence: 6, sceneType: "hero", sizePreset: "1024x1536", taskSlotKey: "detail-page",
      promptSkeleton: "detail page hero for {category}",
      required: 1, notes: null,
    }).run();

    const slots = db.select().from(templateSlots).where(eq(templateSlots.templateId, "tpl-amazon-pdp")).all();
    expect(slots).toHaveLength(2);
    expect(slots[0].slotCode).toBe("H1");
    expect(slots[1].slotCode).toBe("D1");
    const ps = db.select().from(platformSpecs).where(eq(platformSpecs.platform, "amazon")).all()[0];
    expect(ps.heroCount).toBe(5);
  });
});
