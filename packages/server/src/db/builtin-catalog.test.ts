/**
 * builtin-catalog.test.ts — 声明式目录 + seed 凭证语义测试
 * 覆盖：目录加载校验、seed 行为与旧硬编码一致、env 凭证首次引导、
 * 重启不覆盖用户凭证、FORCE_ENV_SYNC=1 强制覆盖。
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ⚠️ 测试隔离：重定向到独立的测试库，绝不污染生产库 data/app.sqlite。
// 必须在首次 getDb() 调用前设置 DB_PATH（client 惰性连接）。
const TMP_DIR = path.resolve(process.cwd(), "data/test-tmp");
const TEST_DB = path.join(TMP_DIR, "test-builtin-catalog.sqlite");
fs.mkdirSync(TMP_DIR, { recursive: true });
if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { force: true });
process.env.DB_PATH = TEST_DB;
// 确定性 env（凭证引导测试用）
process.env.OPENAI_API_KEY = "test-openai-key";
delete process.env.FORCE_ENV_SYNC;

import { getDb, initSchema, __resetDbForTests } from "./client";
import { seedDefaults } from "./seed";
import { loadBuiltinCatalog, modelIdOf } from "./builtin-catalog";
import { vendors, vendorCredentials, models, taskSlots } from "./schema";
import { encryptCredentials, decryptCredentials } from "../model-manager/credentials";
import { eq } from "drizzle-orm";

beforeAll(() => {
  __resetDbForTests();
  initSchema();
  seedDefaults();
});

describe("builtin catalog 加载", () => {
  it("目录包含全部内置供应商且模型 ID 按 vendorId:modelName 生成", () => {
    const c = loadBuiltinCatalog();
    const ids = c.vendors.map((v) => v.id).sort();
    expect(ids).toEqual(["agnes-image", "agnes-video", "aliyun-tryon", "grsai", "kling-video", "orchestrator"]);
    const grsai = c.vendors.find((v) => v.id === "grsai")!;
    expect(modelIdOf(grsai.id, grsai.models[0])).toBe("grsai:gpt-image-2");
  });

  it("taskSlots 引用的供应商均存在", () => {
    const c = loadBuiltinCatalog();
    const ids = new Set(c.vendors.map((v) => v.id));
    for (const s of c.taskSlots) expect(ids.has(s.vendorId)).toBe(true);
  });
});

describe("seed（目录驱动）", () => {
  it("供应商/模型/槽位与旧硬编码行为一致", () => {
    const db = getDb();
    expect(db.select().from(vendors).where(eq(vendors.id, "grsai")).all()[0]?.baseUrl).toBe("https://grsai.dakka.com.cn");
    expect(db.select().from(models).where(eq(models.id, "grsai:gpt-image-2")).all()[0]?.cellSize).toBe(2048);
    expect(db.select().from(taskSlots).where(eq(taskSlots.slotKey, "main-image")).all()[0]?.modelId).toBe("grsai:gpt-image-2");
    expect(db.select().from(taskSlots).where(eq(taskSlots.slotKey, "detail-page")).all()[0]?.modelId).toBe("grsai:gpt-image-2");
    expect(db.select().from(taskSlots).where(eq(taskSlots.slotKey, "vlm")).all()[0]?.modelId).toBe("orchestrator:mimo-v2.5");
    expect(db.select().from(taskSlots).where(eq(taskSlots.slotKey, "video")).all()[0]?.modelId).toBe("agnes-video:agnes-video-v2.0");
    expect(db.select().from(taskSlots).where(eq(taskSlots.slotKey, "tryon")).all()[0]?.modelId).toBe("aliyun-tryon:aitryon");
  });

  it("env 凭证首次引导写入", () => {
    const row = getDb().select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, "grsai")).all()[0];
    expect(row).toBeDefined();
    const values = decryptCredentials(row!.valuesEnc);
    expect(values.apiKey).toBe("test-openai-key");
    expect(values.baseUrl).toBe("https://grsai.dakka.com.cn");
  });

  it("重启不覆盖用户改过的凭证；FORCE_ENV_SYNC=1 才强制覆盖", () => {
    const db = getDb();
    // 模拟用户在设置页改 key（等价 PUT /api/settings/credentials 的写入路径）
    const row = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, "grsai")).all()[0];
    const userValues = { ...decryptCredentials(row.valuesEnc), apiKey: "user-edited-key" };
    db.update(vendorCredentials).set({ valuesEnc: encryptCredentials(userValues), updatedAt: Date.now() })
      .where(eq(vendorCredentials.vendorId, "grsai")).run();

    seedDefaults(); // 模拟重启
    const after = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, "grsai")).all()[0];
    expect(decryptCredentials(after.valuesEnc).apiKey).toBe("user-edited-key"); // 未被 env 覆盖

    process.env.FORCE_ENV_SYNC = "1";
    seedDefaults(); // 强制同步模式重启
    const forced = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, "grsai")).all()[0];
    expect(decryptCredentials(forced.valuesEnc).apiKey).toBe("test-openai-key"); // 覆盖回 env 值
    delete process.env.FORCE_ENV_SYNC;
  });
});
