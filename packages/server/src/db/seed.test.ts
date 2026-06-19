import { describe, it, expect, beforeAll } from "vitest";
import { getDb, getRaw, initSchema } from "./client";
import { templates, templateSlots, platformSpecs, taskSlots } from "./schema";
import { eq } from "drizzle-orm";
import { seedDefaults } from "./seed";

beforeAll(() => {
  initSchema();
});

describe("seed 内置模板", () => {
  it("seedDefaults 创建亚马逊 PDP 模板 + 14 图位 + 平台规格", () => {
    const raw = getRaw();
    // 清表
    for (const t of ["templates", "template_slots", "platform_specs"]) raw.exec(`DELETE FROM ${t}`);
    seedDefaults();

    const db = getDb();
    // 平台规格
    const ps = db.select().from(platformSpecs).where(eq(platformSpecs.platform, "amazon")).all()[0];
    expect(ps).toBeDefined();
    expect(ps?.heroCount).toBe(5);

    // 模板
    const tpl = db.select().from(templates).where(eq(templates.id, "builtin-amazon-pdp")).all()[0];
    expect(tpl).toBeDefined();
    expect(tpl?.name).toContain("亚马逊");
    expect(tpl?.isBuiltin).toBe(1);

    // 14 图位
    const slots = db.select().from(templateSlots).where(eq(templateSlots.templateId, "builtin-amazon-pdp")).all();
    expect(slots).toHaveLength(14);
    // 按 sequence 排序验证 H1-D9 顺序
    slots.sort((a, b) => a.sequence - b.sequence);
    expect(slots[0].slotCode).toBe("H1");
    expect(slots[5].slotCode).toBe("D1");
    expect(slots[13].slotCode).toBe("D9");
    // 验证骨架含占位符
    expect(slots[0].promptSkeleton).toContain("{color}");
    expect(slots[0].promptSkeleton).toContain("{category}");
  });

  it("seedDefaults 幂等：二次调用不重复创建", () => {
    const before = getDb().select().from(templateSlots).where(eq(templateSlots.templateId, "builtin-amazon-pdp")).all().length;
    seedDefaults(); // 再次调用
    const after = getDb().select().from(templateSlots).where(eq(templateSlots.templateId, "builtin-amazon-pdp")).all().length;
    expect(after).toBe(before); // 不重复
  });

  it("detail-page task_slot 已绑定模型", () => {
    const ts = getDb().select().from(taskSlots).where(eq(taskSlots.slotKey, "detail-page")).all()[0];
    expect(ts?.modelId).toBe("grsai:gpt-image-2");
  });
});
