/**
 * server/db/seed.ts — 默认数据 seed（首次启动初始化）
 * 从 .env 读凭证，建立供应商/模型绑定 + 内置模板。
 * 幂等：已存在则跳过。
 */
import { getDb } from "./client";
import { vendors, vendorCredentials, models, taskSlots, templates, templateSlots, platformSpecs } from "./schema";
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

  // 4. detail-page slot 也绑 grsai（模板详情页图位用）
  upsertSlot("detail-page", "grsai:gpt-image-2");

  // 5. aliyun-tryon 供应商（虚拟试穿，凭证需用户在设置页配）
  upsertVendor("aliyun-tryon", "阿里云 OutfitAnyone", "tryon", "aliyun-tryon", null, [passwordInput]);
  upsertModel("aliyun-tryon:aitryon", "aliyun-tryon", "aitryon", "OutfitAnyone 试穿", "tryon", ["singleImage"]);
  upsertSlot("tryon", "aliyun-tryon:aitryon");

  // 6. kling-video 供应商（视频生成，凭证需用户在设置页配）
  upsertVendor("kling-video", "可灵视频", "video", "kling-video", null, [passwordInput]);
  upsertModel("kling-video:kling", "kling-video", "kling", "可灵视频生成", "video", ["singleImage", "text"]);
  upsertSlot("video", "kling-video:kling");

  // 7. 内置模板
  seedTemplates();
}

/** 亚马逊 PDP 套图的 14 个图位定义（可行性报告 §6.3） */
const AMAZON_PDP_SLOTS = [
  // H1-H5 主图（1024x1024）
  { slotCode: "H1", purpose: "首图卖点—一眼可懂的视觉主张", sequence: 1, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "Clean white background product photo of a {category}, the main product centered, color {color}, material {material}. Studio lighting, sharp focus, e-commerce hero shot. No text overlay.", notes: "白底无文字，产品居中" },
  { slotCode: "H2", purpose: "核心功能/质感特写", sequence: 2, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "Extreme close-up macro shot of a {color} {category} showing {material} texture and craftsmanship detail. White background, studio lighting.", notes: "突出材质工艺" },
  { slotCode: "H3", purpose: "使用场景匹配", sequence: 3, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "Lifestyle scene photo of {color} {category} in realistic use environment, natural lighting, shallow depth of field, showing the product in context.", notes: "真实使用场景" },
  { slotCode: "H4", purpose: "普通方案 vs 升级方案对比", sequence: 4, sceneType: "before-after", size: "1024x1024", taskSlot: "main-image", skeleton: "Side-by-side comparison: left shows ordinary {category}, right shows upgraded {color} {category}. Split frame, clean background, highlighting advantages.", notes: "左右对比突出优势" },
  { slotCode: "H5", purpose: "优惠/物流/保障/CTA", sequence: 5, sceneType: "infographic", size: "1024x1024", taskSlot: "main-image", skeleton: "Infographic product image of {color} {category} with icons showing fast shipping, quality guarantee, and special offer. Clean modern layout, white background.", notes: "信息图+CTA" },
  // D1-D9 详情页（1024x1536）
  { slotCode: "D1", purpose: "首屏承接—为谁解决什么", sequence: 6, sceneType: "hero", size: "1024x1536", taskSlot: "detail-page", skeleton: "Detail page hero image for {color} {category}. Large product showcase with a clear value proposition at top. Professional e-commerce layout, {material} quality visible.", notes: "痛点+产品承诺" },
  { slotCode: "D2", purpose: "痛点放大", sequence: 7, sceneType: "lifestyle", size: "1024x1536", taskSlot: "detail-page", skeleton: "Detail page section showing the problem/pain point that {category} solves. Relatable scenario, muted tones for problem depiction, vertical layout.", notes: "展示用户当前不便" },
  { slotCode: "D3", purpose: "机制解释", sequence: 8, sceneType: "infographic", size: "1024x1536", taskSlot: "detail-page", skeleton: "Infographic explaining how the {color} {category} works. Cutaway or diagram style showing internal mechanism and {material} construction. Vertical detail page format.", notes: "产品原理可视化" },
  { slotCode: "D4", purpose: "核心利益", sequence: 9, sceneType: "infographic", size: "1024x1536", taskSlot: "detail-page", skeleton: "Detail page showing 3-4 key benefits of {color} {category} with icons and short labels. Clean grid layout, vertical format, white background.", notes: "2-4利益信息图" },
  { slotCode: "D5", purpose: "使用步骤", sequence: 10, sceneType: "infographic", size: "1024x1536", taskSlot: "detail-page", skeleton: "Step-by-step usage guide for {category}, 3-4 numbered steps with simple illustrations. Vertical timeline layout, clean background.", notes: "3-4步说明" },
  { slotCode: "D6", purpose: "场景覆盖", sequence: 11, sceneType: "lifestyle", size: "1024x1536", taskSlot: "detail-page", skeleton: "Multiple usage scenarios of {color} {category} in different environments. Grid of lifestyle photos, vertical detail page format.", notes: "典型使用场景" },
  { slotCode: "D7", purpose: "对比选择", sequence: 12, sceneType: "before-after", size: "1024x1536", taskSlot: "detail-page", skeleton: "Comparison detail page: ordinary {category} vs this {color} {category}. Detailed feature comparison, vertical format, highlighting superiority.", notes: "普通方案 vs 本品" },
  { slotCode: "D8", purpose: "信任背书", sequence: 13, sceneType: "infographic", size: "1024x1536", taskSlot: "detail-page", skeleton: "Trust and endorsement detail page for {color} {category}. Showing material certification, quality inspection badges, warranty info. Professional vertical layout.", notes: "材料/质检/保障" },
  { slotCode: "D9", purpose: "FAQ/风险逆转/CTA", sequence: 14, sceneType: "infographic", size: "1024x1536", taskSlot: "detail-page", skeleton: "FAQ and call-to-action detail page for {color} {category}. Common questions with answers, money-back guarantee, strong CTA at bottom. Vertical format.", notes: "常见问题+CTA" },
];

/** seed 内置模板（亚马逊 PDP 套图） */
function seedTemplates(): void {
  const db = getDb();
  const now = Date.now();

  // 平台规格
  const psExists = db.select().from(platformSpecs).where(eq(platformSpecs.platform, "amazon")).all()[0];
  if (!psExists) {
    db.insert(platformSpecs).values({
      platform: "amazon", heroSize: "1024x1024", detailSize: "1024x1536", heroCount: 5,
      rules: JSON.stringify({ firstImageWhiteBg: true, noWatermark: true }),
      textRenderPref: "英文",
    }).run();
  }
  // 国内四大平台规格
  const cnPlatforms = [
    { platform: "taobao", heroSize: "1024x1024", detailSize: "1024x1536", heroCount: 5, rules: { firstImageWhiteBg: true, detailWidth: "750px", maxSize: "3MB" }, textRenderPref: "中文" },
    { platform: "jd", heroSize: "1024x1024", detailSize: "1024x1536", heroCount: 6, rules: { firstImageWhiteBg: true, mandatory: "第1张必须纯白底", detailWidth: "750px" }, textRenderPref: "中文" },
    { platform: "douyin", heroSize: "1024x1024", detailSize: "1024x1536", heroCount: 5, rules: { firstImageReal: true, style: "生活化短视频", detailRatio: "16:9" }, textRenderPref: "中文" },
    { platform: "pdd", heroSize: "1024x1024", detailSize: "1024x1536", heroCount: 10, rules: { firstImageWhiteBg: true, mandatory: "纯白底商品居中", maxHeroSize: "1MB" }, textRenderPref: "中文" },
  ];
  for (const p of cnPlatforms) {
    const exists = db.select().from(platformSpecs).where(eq(platformSpecs.platform, p.platform)).all()[0];
    if (!exists) {
      db.insert(platformSpecs).values({
        platform: p.platform, heroSize: p.heroSize, detailSize: p.detailSize, heroCount: p.heroCount,
        rules: JSON.stringify(p.rules), textRenderPref: p.textRenderPref,
      }).run();
    }
  }

  // 模板主记录
  const tplId = "builtin-amazon-pdp";
  const tplExists = db.select().from(templates).where(eq(templates.id, tplId)).all()[0];
  if (!tplExists) {
    db.insert(templates).values({
      id: tplId, name: "亚马逊 PDP 标准套图", category: "pdp", platform: "amazon",
      productCategory: null, description: "5 张主图 + 9 张详情页（行业标配信息架构）",
      isBuiltin: 1, version: 1, createdAt: now, updatedAt: now,
    }).run();
  }

  // 图位（幂等：按 templateId 清理后重插，便于骨架迭代）
  const existingSlots = db.select().from(templateSlots).where(eq(templateSlots.templateId, tplId)).all();
  if (existingSlots.length === 0) {
    for (const s of AMAZON_PDP_SLOTS) {
      db.insert(templateSlots).values({
        id: `${tplId}-${s.slotCode}`, templateId: tplId, slotCode: s.slotCode,
        purpose: s.purpose, sequence: s.sequence, sceneType: s.sceneType,
        sizePreset: s.size, taskSlotKey: s.taskSlot, promptSkeleton: s.skeleton,
        required: 1, notes: s.notes,
      }).run();
    }
  }
}
