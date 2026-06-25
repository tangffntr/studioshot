/**
 * server/db/seed.ts — 默认数据 seed（首次启动初始化）
 * 从 .env 读凭证，建立供应商/模型绑定 + 内置模板。
 * 幂等：已存在则跳过。
 */
import { getDb } from "./client";
import { vendors, vendorCredentials, models, taskSlots, templates, templateSlots, platformSpecs, materials } from "./schema";
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
  function upsertModel(id: string, vendorId: string, modelName: string, displayName: string, type: string, modes: string[], cellSize: number = 1024) {
    const exists = db.select().from(models).where(eq(models.id, id)).all()[0];
    if (exists) return;
    db.insert(models).values({
      id, vendorId, modelName, displayName, type,
      modes: JSON.stringify(modes), pricing: JSON.stringify({ unit: "per-call", price: 50 }), enabled: 1, cellSize,
    }).run();
  }
  function upsertSlot(slotKey: string, modelId: string) {
    // 幂等：已存在则跳过（保留用户在设置页的配置）。
    // 否则每次服务器启动都会把用户手动配置的槽位覆盖回默认值。
    const exists = db.select().from(taskSlots).where(eq(taskSlots.slotKey, slotKey)).all()[0];
    if (exists) return;
    db.insert(taskSlots).values({ slotKey, modelId, params: null }).run();
  }

  const passwordInput = { key: "apiKey", label: "API Key", type: "password" as const, required: true };

  // 1. grsai 生图（gpt-image-2，2k 模型）
  upsertVendor("grsai", "Grsai (gpt-image-2)", "image", "grsai", process.env.OPENAI_BASE_URL || "https://grsai.dakka.com.cn", [passwordInput]);
  if (process.env.OPENAI_API_KEY) {
    upsertCred("grsai", { apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || "https://grsai.dakka.com.cn" });
  }
  upsertModel("grsai:gpt-image-2", "grsai", "gpt-image-2", "GPT Image 2", "image", ["text", "singleImage", "multiReference"], 2048);
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
  upsertSlot("video", "agnes-video:agnes-video-v2.0");

  // 7. agnes-image 供应商（Agnes 图片生成）
  upsertVendor("agnes-image", "Agnes 图片生成", "image", "agnes-image", "https://apihub.agnes-ai.com", [passwordInput]);
  if (process.env.AGNES_API_KEY) {
    upsertCred("agnes-image", { apiKey: process.env.AGNES_API_KEY, baseUrl: "https://apihub.agnes-ai.com" });
  }
  upsertModel("agnes-image:agnes-image-2.1-flash", "agnes-image", "agnes-image-2.1-flash", "Agnes Image 2.1 Flash", "image", ["text"], 1024);

  // 8. agnes-video 供应商（Agnes 视频生成）
  upsertVendor("agnes-video", "Agnes 视频生成", "video", "agnes-video", "https://apihub.agnes-ai.com", [passwordInput]);
  if (process.env.AGNES_API_KEY) {
    upsertCred("agnes-video", { apiKey: process.env.AGNES_API_KEY, baseUrl: "https://apihub.agnes-ai.com" });
  }
  upsertModel("agnes-video:agnes-video-v2.0", "agnes-video", "agnes-video-v2.0", "Agnes Video v2.0", "video", ["text"]);

  // 9. 内置模板
  seedTemplates();
  // 8. 内置素材（prompt 骨架）
  seedBuiltinMaterials();
}

/** 亚马逊 PDP 套图的 14 个图位定义（可行性报告 §6.3） */
const AMAZON_PDP_SLOTS = [
  // H1-H5 主图（1024x1024）
  { slotCode: "H1", purpose: "首图卖点—一眼可懂的视觉主张", sequence: 1, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "亚马逊风格白底产品图：{color} {category}产品居中，纯白背景，{material}质感清晰，影棚光，锐利对焦，电商主图风格，不叠加文字。", notes: "白底无文字，产品居中" },
  { slotCode: "H2", purpose: "核心功能/质感特写", sequence: 2, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "亚马逊风格极近微距特写：{color} {category}，展示{material}材质纹理与工艺细节，白色背景，影棚光。", notes: "突出材质工艺" },
  { slotCode: "H3", purpose: "使用场景匹配", sequence: 3, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "亚马逊风格生活场景图：{color} {category}融入真实使用场景，自然光，浅景深，展示产品在情境中的使用。", notes: "真实使用场景" },
  { slotCode: "H4", purpose: "普通方案 vs 升级方案对比", sequence: 4, sceneType: "before-after", size: "1024x1024", taskSlot: "main-image", skeleton: "亚马逊风格对比图：左侧为普通{category}，右侧为升级版{color} {category}。左右分屏，干净背景，突出优势差异。", notes: "左右对比突出优势" },
  { slotCode: "H5", purpose: "优惠/物流/保障/CTA", sequence: 5, sceneType: "infographic", size: "1024x1024", taskSlot: "main-image", skeleton: "亚马逊风格信息图：{color} {category}，配图标展示快速物流、品质保障、限时优惠。简洁现代排版，白色背景。", notes: "信息图+CTA" },
  // D1-D9 详情页（1024x1536）
  { slotCode: "D1", purpose: "首屏承接—为谁解决什么", sequence: 6, sceneType: "hero", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页首屏：{color} {category}产品大图展示，顶部清晰的价值主张，专业电商排版，{material}品质清晰可见。", notes: "痛点+产品承诺" },
  { slotCode: "D2", purpose: "痛点放大", sequence: 7, sceneType: "lifestyle", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页痛点图：展示{category}所解决的用户痛点，贴近生活的场景，用低饱和色调表现困扰，竖版排版。", notes: "展示用户当前不便" },
  { slotCode: "D3", purpose: "机制解释", sequence: 8, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页机制图：图解{color} {category}的工作原理，剖面或示意图风格展示内部构造与{material}材质，竖版详情页排版。", notes: "产品原理可视化" },
  { slotCode: "D4", purpose: "核心利益", sequence: 9, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页利益图：展示{color} {category}的3-4个核心利益，配图标和简短文案，干净网格排版，竖版，白色背景。", notes: "2-4利益信息图" },
  { slotCode: "D5", purpose: "使用步骤", sequence: 10, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页步骤图：{category}的使用步骤指南，3-4个编号步骤配简洁插画，竖版时间轴排版，干净背景。", notes: "3-4步说明" },
  { slotCode: "D6", purpose: "场景覆盖", sequence: 11, sceneType: "lifestyle", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页场景图：{color} {category}在多个不同环境的使用场景，生活场景照片网格，竖版详情页排版。", notes: "典型使用场景" },
  { slotCode: "D7", purpose: "对比选择", sequence: 12, sceneType: "before-after", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页对比图：普通{category}与本款{color} {category}详细功能对比，竖版排版，突出优越性。", notes: "普通方案 vs 本品" },
  { slotCode: "D8", purpose: "信任背书", sequence: 13, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页信任图：{color} {category}的信任背书，展示材料认证、质检徽章、保修信息，专业竖版排版。", notes: "材料/质检/保障" },
  { slotCode: "D9", purpose: "FAQ/风险逆转/CTA", sequence: 14, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "亚马逊详情页FAQ图：{color} {category}常见问题与解答，退款保障，底部强力行动号召(CTA)，竖版排版。", notes: "常见问题+CTA" },
];

/** 淘宝 PDP 套图的 10 个图位定义（国内电商标准） */
const TAOBAO_PDP_SLOTS = [
  // H1-H5 主图（1024x1024）
  { slotCode: "H1", purpose: "白底主图—淘宝强制要求", sequence: 1, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "淘宝风格白底主图：{color} {category}产品居中，纯白背景(#FFFFFF)，800x800正方形，明亮均匀光照，产品清晰无文字水印，突出{material}质感。", notes: "第一张必须白底，无文字" },
  { slotCode: "H2", purpose: "产品卖点展示", sequence: 2, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "淘宝风格产品卖点图：{color} {category}核心卖点展示，{material}材质特写，简洁排版，白底为主，突出产品优势。", notes: "展示核心卖点" },
  { slotCode: "H3", purpose: "使用场景图", sequence: 3, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "淘宝风格生活场景图：{color} {category}融入真实使用场景，自然光，暖调，手机端友好的竖图构图，突出使用体验。", notes: "真实使用场景" },
  { slotCode: "H4", purpose: "细节特写", sequence: 4, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "淘宝风格细节特写图：{color} {category}极近距离微距拍摄，展示{material}材质纹理和工艺细节，影棚光照，白色背景。", notes: "材质工艺特写" },
  { slotCode: "H5", purpose: "促销信息/规格参数", sequence: 5, sceneType: "infographic", size: "1024x1024", taskSlot: "main-image", skeleton: "淘宝风格规格参数图：{color} {category}产品参数清晰展示，包含尺寸、重量、材质等信息，简洁排版，白底为主。", notes: "规格参数展示" },
  // D1-D5 详情页（1024x1536）
  { slotCode: "D1", purpose: "详情页首屏—核心卖点", sequence: 6, sceneType: "hero", size: "1024x2400", taskSlot: "detail-page", skeleton: "淘宝详情页首屏：{color} {category}核心卖点大图展示，{material}材质突出，竖版排版，宽750px适配，吸引用户继续浏览。", notes: "首屏吸引力" },
  { slotCode: "D2", purpose: "产品优势对比", sequence: 7, sceneType: "before-after", size: "1024x2400", taskSlot: "detail-page", skeleton: "淘宝详情页对比图：{color} {category}与普通产品对比，突出优势，竖版排版，清晰展示差异。", notes: "对比突出优势" },
  { slotCode: "D3", purpose: "使用场景展示", sequence: 8, sceneType: "lifestyle", size: "1024x2400", taskSlot: "detail-page", skeleton: "淘宝详情页场景图：{color} {category}多场景使用展示，生活化风格，竖版排版，展示产品适用性。", notes: "多场景展示" },
  { slotCode: "D4", purpose: "材质工艺详解", sequence: 9, sceneType: "detail-macro", size: "1024x2400", taskSlot: "detail-page", skeleton: "淘宝详情页材质图：{color} {category} {material}材质工艺详解，微距拍摄，竖版排版，展示品质感。", notes: "材质工艺详解" },
  { slotCode: "D5", purpose: "售后保障/FAQ", sequence: 10, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "淘宝详情页售后图：{color} {category}售后保障信息，包含退换货政策、质保说明，竖版排版，增强购买信心。", notes: "售后保障信息" },
];

/** 京东 PDP 套图的 11 个图位定义 */
const JD_PDP_SLOTS = [
  // H1-H6 主图（1024x1024）
  { slotCode: "H1", purpose: "白底主图—京东强制要求", sequence: 1, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "京东风格主图：{color} {category}产品居中，纯白背景强制要求，冷调专业风格，800x800正方形，高清无模糊，第一张必须白底。", notes: "第一张必须纯白底" },
  { slotCode: "H2", purpose: "产品正面展示", sequence: 2, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "京东风格产品正面图：{color} {category}正面展示，专业影棚光照，白底，突出产品全貌。", notes: "产品正面全貌" },
  { slotCode: "H3", purpose: "产品侧面/背面", sequence: 3, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "京东风格产品侧面图：{color} {category}侧面或背面展示，专业影棚光照，白底，展示产品细节。", notes: "多角度展示" },
  { slotCode: "H4", purpose: "核心卖点", sequence: 4, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "京东风格卖点图：{color} {category}核心卖点展示，{material}材质特写，冷调专业风格，白底。", notes: "核心卖点展示" },
  { slotCode: "H5", purpose: "使用场景", sequence: 5, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "京东风格场景图：{color} {category}使用场景展示，专业摄影风格，冷调，突出产品使用效果。", notes: "使用场景" },
  { slotCode: "H6", purpose: "规格参数", sequence: 6, sceneType: "infographic", size: "1024x1024", taskSlot: "main-image", skeleton: "京东风格参数图：{color} {category}规格参数展示，冷调专业排版，白底，信息清晰。", notes: "规格参数" },
  // D1-D5 详情页（1024x1536）
  { slotCode: "D1", purpose: "详情页首屏—品牌承诺", sequence: 7, sceneType: "hero", size: "1024x2400", taskSlot: "detail-page", skeleton: "京东详情页首屏：{color} {category}品牌承诺大图，{material}品质保证，冷调专业风格，竖版排版。", notes: "品牌承诺" },
  { slotCode: "D2", purpose: "产品优势详解", sequence: 8, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "京东详情页优势图：{color} {category}产品优势详解，冷调专业排版，竖版，突出核心竞争力。", notes: "优势详解" },
  { slotCode: "D3", purpose: "材质工艺", sequence: 9, sceneType: "detail-macro", size: "1024x2400", taskSlot: "detail-page", skeleton: "京东详情页材质图：{color} {category} {material}材质工艺展示，微距拍摄，竖版，展示品质感。", notes: "材质工艺" },
  { slotCode: "D4", purpose: "使用场景", sequence: 10, sceneType: "lifestyle", size: "1024x2400", taskSlot: "detail-page", skeleton: "京东详情页场景图：{color} {category}多场景使用展示，专业摄影风格，竖版，展示适用性。", notes: "使用场景" },
  { slotCode: "D5", purpose: "售后保障/品牌背书", sequence: 11, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "京东详情页保障图：{color} {category}售后保障和品牌背书，包含质检认证、售后政策，竖版，增强信任。", notes: "售后保障" },
];

/** 抖音 PDP 套图的 8 个图位定义 */
const DOUYIN_PDP_SLOTS = [
  // H1-H5 主图（1024x1024）
  { slotCode: "H1", purpose: "实物主图—抖音要求", sequence: 1, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "抖音风格实物主图：{color} {category}真实感拍摄风格，非棚拍感，暖调生活化，800x800，第一张必须实物图不得全屏水印。", notes: "第一张必须实物图" },
  { slotCode: "H2", purpose: "种草风格图", sequence: 2, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "抖音种草风格图：{color} {category}手机拍摄感，真实生活场景，暖调滤镜，产品自然融入画面，有分享欲的构图。", notes: "种草风格" },
  { slotCode: "H3", purpose: "使用效果展示", sequence: 3, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "抖音效果展示图：{color} {category}使用效果对比，真实拍摄风格，暖调，突出使用前后差异。", notes: "效果对比" },
  { slotCode: "H4", purpose: "细节展示", sequence: 4, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "抖音细节图：{color} {category} {material}材质细节，手机拍摄感，暖调，真实感强。", notes: "细节展示" },
  { slotCode: "H5", purpose: "促销信息", sequence: 5, sceneType: "infographic", size: "1024x1024", taskSlot: "main-image", skeleton: "抖音促销图：{color} {category}促销信息展示，暖调风格，简洁排版，突出优惠。", notes: "促销信息" },
  // D1-D3 详情页（1024x1536）
  { slotCode: "D1", purpose: "详情页首屏—种草引导", sequence: 6, sceneType: "hero", size: "1024x2400", taskSlot: "detail-page", skeleton: "抖音详情页首屏：{color} {category}种草引导，暖调生活化风格，竖版，吸引用户继续浏览。", notes: "种草引导" },
  { slotCode: "D2", purpose: "使用场景", sequence: 7, sceneType: "lifestyle", size: "1024x2400", taskSlot: "detail-page", skeleton: "抖音详情页场景图：{color} {category}多场景使用展示，生活化风格，竖版，展示产品适用性。", notes: "使用场景" },
  { slotCode: "D3", purpose: "购买引导/售后", sequence: 8, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "抖音详情页引导图：{color} {category}购买引导和售后信息，暖调风格，竖版，促进转化。", notes: "购买引导" },
];

/** 拼多多 PDP 套图的 10 个图位定义 */
const PDD_PDP_SLOTS = [
  // H1-H5 主图（1024x1024）
  { slotCode: "H1", purpose: "白底主图—拼多多要求", sequence: 1, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "拼多多风格主图：{color} {category}纯白底商品居中，高对比度突出产品，750x750正方形，不可加水印文字，突出性价比。", notes: "纯白底商品居中" },
  { slotCode: "H2", purpose: "产品展示", sequence: 2, sceneType: "hero", size: "1024x1024", taskSlot: "main-image", skeleton: "拼多多风格产品图：{color} {category}产品展示，白底，高对比度，突出产品外观。", notes: "产品展示" },
  { slotCode: "H3", purpose: "卖点展示", sequence: 3, sceneType: "detail-macro", size: "1024x1024", taskSlot: "main-image", skeleton: "拼多多风格卖点图：{color} {category}核心卖点展示，简洁明了，白底为主，突出性价比。", notes: "卖点展示" },
  { slotCode: "H4", purpose: "使用场景", sequence: 4, sceneType: "lifestyle", size: "1024x1024", taskSlot: "main-image", skeleton: "拼多多风格场景图：{color} {category}使用场景，简洁风格，白底为主，突出实用性。", notes: "使用场景" },
  { slotCode: "H5", purpose: "促销信息", sequence: 5, sceneType: "infographic", size: "1024x1024", taskSlot: "main-image", skeleton: "拼多多风格促销图：{color} {category}促销信息，高饱和色彩，简洁价格标签风格，突出优惠信息。", notes: "促销信息" },
  // D1-D5 详情页（1024x1536）
  { slotCode: "D1", purpose: "详情页首屏—核心卖点", sequence: 6, sceneType: "hero", size: "1024x2400", taskSlot: "detail-page", skeleton: "拼多多详情页首屏：{color} {category}核心卖点大图，简洁明了，竖版，突出性价比。", notes: "核心卖点" },
  { slotCode: "D2", purpose: "产品优势", sequence: 7, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "拼多多详情页优势图：{color} {category}产品优势展示，简洁排版，竖版，突出实用价值。", notes: "产品优势" },
  { slotCode: "D3", purpose: "使用场景", sequence: 8, sceneType: "lifestyle", size: "1024x2400", taskSlot: "detail-page", skeleton: "拼多多详情页场景图：{color} {category}使用场景展示，简洁风格，竖版，展示实用性。", notes: "使用场景" },
  { slotCode: "D4", purpose: "规格参数", sequence: 9, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "拼多多详情页参数图：{color} {category}规格参数展示，简洁排版，竖版，信息清晰。", notes: "规格参数" },
  { slotCode: "D5", purpose: "售后保障", sequence: 10, sceneType: "infographic", size: "1024x2400", taskSlot: "detail-page", skeleton: "拼多多详情页保障图：{color} {category}售后保障信息，简洁排版，竖版，增强购买信心。", notes: "售后保障" },
];

/** seed 内置模板（亚马逊 PDP 套图 + 国内电商模板） */
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

  // 模板定义
  const templateDefs = [
    { id: "builtin-amazon-pdp", name: "亚马逊 PDP 标准套图", platform: "amazon", description: "5 张主图 + 9 张详情页（行业标配信息架构）", slots: AMAZON_PDP_SLOTS },
    { id: "builtin-taobao-pdp", name: "淘宝 PDP 标准套图", platform: "taobao", description: "5 张主图 + 5 张详情页（淘宝电商标准）", slots: TAOBAO_PDP_SLOTS },
    { id: "builtin-jd-pdp", name: "京东 PDP 标准套图", platform: "jd", description: "6 张主图 + 5 张详情页（京东电商标准）", slots: JD_PDP_SLOTS },
    { id: "builtin-douyin-pdp", name: "抖音 PDP 标准套图", platform: "douyin", description: "5 张主图 + 3 张详情页（抖音电商标准）", slots: DOUYIN_PDP_SLOTS },
    { id: "builtin-pdd-pdp", name: "拼多多 PDP 标准套图", platform: "pdd", description: "5 张主图 + 5 张详情页（拼多多电商标准）", slots: PDD_PDP_SLOTS },
  ];

  for (const tpl of templateDefs) {
    // 模板主记录
    const tplExists = db.select().from(templates).where(eq(templates.id, tpl.id)).all()[0];
    if (!tplExists) {
      db.insert(templates).values({
        id: tpl.id, name: tpl.name, category: "pdp", platform: tpl.platform,
        productCategory: null, description: tpl.description,
        isBuiltin: 1, version: 1, createdAt: now, updatedAt: now,
      }).run();
    }

    // 图位（幂等：按 templateId 清理后重插，便于骨架迭代）
    const existingSlots = db.select().from(templateSlots).where(eq(templateSlots.templateId, tpl.id)).all();
    if (existingSlots.length === 0) {
      for (const s of tpl.slots) {
        db.insert(templateSlots).values({
          id: `${tpl.id}-${s.slotCode}`, templateId: tpl.id, slotCode: s.slotCode,
          purpose: s.purpose, sequence: s.sequence, sceneType: s.sceneType,
          sizePreset: s.size, taskSlotKey: s.taskSlot, promptSkeleton: s.skeleton,
          required: 1, notes: s.notes,
        }).run();
      }
    }
  }
}

/** 内置 prompt 骨架素材（各平台×各场景，纯 prompt 无图片） */
const BUILTIN_MATERIALS = [
  // 通用
  { name: "白底主图（通用）", kind: "prompt-skeleton", platform: null, category: "hero", prompt: "白底主图：产品居中，纯白背景，明亮均匀的影棚光照，产品清晰锐利，电商主图风格，高细节，无文字水印。" },
  { name: "生活场景图（通用）", kind: "prompt-skeleton", platform: null, category: "lifestyle", prompt: "生活场景图：产品融入真实的家居使用场景，自然光，浅景深，温馨舒适的氛围，突出使用体验。" },
  { name: "细节特写图（通用）", kind: "prompt-skeleton", platform: null, category: "detail", prompt: "细节特写图：极近距离微距拍摄，展示材质纹理和工艺细节，影棚光照，白色背景。" },
  { name: "信息图/卖点图（通用）", kind: "prompt-skeleton", platform: null, category: "infographic", prompt: "信息图：3-4个核心卖点用图标加短文案展示，清爽现代排版，白色背景，专业设计感。" },
  // 淘宝
  { name: "淘宝白底主图", kind: "prompt-skeleton", platform: "taobao", category: "hero", prompt: "淘宝风格白底主图：产品居中，纯白背景(#FFFFFF)，800x800正方形，明亮均匀光照，产品清晰无文字水印，突出质感。" },
  { name: "淘宝场景图", kind: "prompt-skeleton", platform: "taobao", category: "lifestyle", prompt: "淘宝风格生活场景图：产品融入真实使用场景，自然光，暖调，手机端友好的竖图构图，突出使用体验。" },
  { name: "淘宝详情页信息图", kind: "prompt-skeleton", platform: "taobao", category: "detail", prompt: "淘宝详情页信息图：宽750px竖版，产品卖点用图标+短文案展示，清爽排版，白底为主，突出核心优势。" },
  // 京东
  { name: "京东白底主图", kind: "prompt-skeleton", platform: "jd", category: "hero", prompt: "京东风格主图：纯白背景强制要求，产品居中满画布，冷调专业风格，800x800正方形，高清无模糊，第一张必须白底。" },
  { name: "京东详情页", kind: "prompt-skeleton", platform: "jd", category: "detail", prompt: "京东风格详情页：宽750px竖版，冷调专业排版，产品参数清晰展示，信任背书元素（质检/保障），简洁高端感。" },
  // 抖音
  { name: "抖音实物主图", kind: "prompt-skeleton", platform: "douyin", category: "hero", prompt: "抖音风格实物主图：真实感拍摄风格，非棚拍感，暖调生活化，800x800，第一张必须实物图不得全屏水印，短视频生态适配。" },
  { name: "抖音种草图", kind: "prompt-skeleton", platform: "douyin", category: "lifestyle", prompt: "抖音种草风格图：手机拍摄感，真实生活场景，暖调滤镜，产品自然融入画面，有分享欲的构图，适合短视频封面。" },
  // 拼多多
  { name: "拼多多白底主图", kind: "prompt-skeleton", platform: "pdd", category: "hero", prompt: "拼多多风格主图：纯白底商品居中，高对比度突出产品，750x750正方形，不可加水印文字，突出性价比，简洁明了。" },
  { name: "拼多多促销图", kind: "prompt-skeleton", platform: "pdd", category: "infographic", prompt: "拼多多风格促销图：高饱和色彩，产品大图居中，简洁价格标签风格，白底为主，突出优惠信息，适合价格敏感用户。" },
];

function seedBuiltinMaterials(): void {
  const db = getDb();
  const now = Date.now();
  for (const m of BUILTIN_MATERIALS) {
    const id = `builtin-mat-${m.platform || "common"}-${m.category}`;
    const exists = db.select().from(materials).where(eq(materials.id, id)).all()[0];
    if (!exists) {
      db.insert(materials).values({
        id, name: m.name, promptText: m.prompt, filePath: null,
        sourceMediaId: null, kind: m.kind, platform: m.platform, category: m.category,
        createdAt: now,
      }).run();
    }
  }
}
