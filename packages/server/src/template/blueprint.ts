/**
 * server/template/blueprint.ts — 页面规划生成器
 * 参考DetailFlow工作流，生成结构化的8屏详情页规划
 */
import type {
  PageBlueprint,
  ScreenPlan,
  VisualDNA,
  CopyStructurePattern,
  ContentDensity,
} from "@ecom/shared";
import { Model } from "../model-manager/facade";
import type { ProductAttributes } from "./render";

/** 规划生成请求 */
export interface BlueprintRequest {
  productName: string;
  productCategory: string;
  targetAudience?: string;
  sellingPoints?: string[];
  prohibitedClaims?: string[];
  platform?: string;
  productAttributes?: ProductAttributes;
  referenceStyle?: string;
}

/** 从VLM分析结果推断卖点 */
function inferClaimSeeds(_attrs: ProductAttributes, category: string): string[] {
  const seeds: string[] = [];

  // 基于属性推断卖点
  if (_attrs.material) {
    seeds.push(`${_attrs.material}材质`);
  }
  if (_attrs.color) {
    seeds.push(`${_attrs.color}配色`);
  }
  if (_attrs.style) {
    seeds.push(`${_attrs.style}风格`);
  }

  // 基于品类推断通用卖点
  const categorySeeds: Record<string, string[]> = {
    "mug": ["舒适握感", "精美图案", "耐用材质"],
    "bottle": ["便携设计", "密封防漏", "健康材质"],
    "shirt": ["舒适面料", "时尚剪裁", "百搭款式"],
    "phone": ["高清屏幕", "流畅性能", "长续航"],
    "headset": ["舒适佩戴", "清晰音质", "降噪效果"],
    "default": ["优质品质", "精致工艺", "实用设计"],
  };

  const inferred = categorySeeds[category] || categorySeeds["default"];
  seeds.push(...inferred);

  // 返回2-4个种子
  return seeds.slice(0, 4);
}

/** 生成首屏规划 */
function generateFirstScreen(
  claimSeeds: string[],
  productName: string,
  _attrs: ProductAttributes
): ScreenPlan {
  return {
    sliceId: "01",
    buyerQuestion: "这是什么？适合谁？为什么重要？",
    moduleType: "hero",
    moduleLabel: "产品身份",
    claimSeed: claimSeeds.join(", "),
    screenJob: "建立产品身份，展示核心卖点",
    evidenceType: "product_identity",
    contentDensity: "high",
    layoutArchetype: "hero_claim",
    copyModuleType: "hero_headline",
    copyStructurePattern: "hero_claim_stack",
    primaryModule: {
      role: "产品主图",
      areaRatio: 0.6,
      visualDirection: "居中展示，突出产品",
      message: `${productName}核心展示`,
    },
    secondaryModules: [
      {
        role: "卖点标签",
        areaRatio: 0.2,
        visualDirection: "底部标签群",
        message: claimSeeds.slice(0, 3).join(" | "),
      },
    ],
    textExact: {
      headline: productName,
      subheadline: claimSeeds[0] || "优质产品",
      tags: claimSeeds.slice(0, 3),
      cta: "立即购买",
    },
    hierarchyStrategy: "标题最大，产品居中，标签辅助",
    compositionShift: "全幅产品展示",
    topEdgeAnchor: "无",
    bottomEdgeAnchor: "产品底部过渡",
    visualComposition: "产品居中，背景简洁",
    referenceStyleNotes: "参考风格元素",
    riskUnknowns: [],
  };
}

/** 生成后续屏幕规划 */
function generateSubsequentScreen(
  sliceId: string,
  buyerQuestion: string,
  claimSeed: string,
  moduleType: string,
  copyPattern: CopyStructurePattern,
  screenJob: string
): ScreenPlan {
  const densityMap: Record<string, ContentDensity> = {
    "benefit": "high",
    "mechanism": "medium",
    "function": "high",
    "detail": "medium",
    "scenario": "low",
    "proof": "medium",
    "comparison": "high",
    "closing": "medium",
  };

  return {
    sliceId,
    buyerQuestion,
    moduleType,
    moduleLabel: moduleType,
    claimSeed,
    screenJob,
    evidenceType: moduleType === "proof" ? "trust_note" : "lifestyle_result",
    contentDensity: densityMap[moduleType] || "medium",
    layoutArchetype: moduleType,
    copyModuleType: copyPattern,
    copyStructurePattern: copyPattern,
    primaryModule: {
      role: `${moduleType}主模块`,
      areaRatio: 0.5,
      visualDirection: "突出核心信息",
      message: screenJob,
    },
    secondaryModules: [],
    textExact: {},
    hierarchyStrategy: "主次分明",
    compositionShift: "与首屏差异化",
    topEdgeAnchor: "延续上一屏视觉元素",
    bottomEdgeAnchor: "引导下一屏",
    visualComposition: "信息清晰",
    referenceStyleNotes: "保持风格一致",
    riskUnknowns: [],
  };
}

/** 规划模板 */
const SCREEN_TEMPLATES = [
  {
    sliceId: "02",
    buyerQuestion: "解决什么问题？",
    moduleType: "benefit",
    copyPattern: "question_answer" as CopyStructurePattern,
    screenJob: "展示产品解决的核心痛点",
  },
  {
    sliceId: "03",
    buyerQuestion: "核心优势是什么？",
    moduleType: "function",
    copyPattern: "three_point_breakdown" as CopyStructurePattern,
    screenJob: "展示产品最强功能或情感价值",
  },
  {
    sliceId: "04",
    buyerQuestion: "如何工作？材质如何？",
    moduleType: "mechanism",
    copyPattern: "annotation_map" as CopyStructurePattern,
    screenJob: "展示产品结构、材质、工艺细节",
  },
  {
    sliceId: "05",
    buyerQuestion: "什么场景使用？",
    moduleType: "scenario",
    copyPattern: "scene_caption_cluster" as CopyStructurePattern,
    screenJob: "展示3-5个真实使用场景",
  },
  {
    sliceId: "06",
    buyerQuestion: "有什么证明？",
    moduleType: "proof",
    copyPattern: "trust_checklist" as CopyStructurePattern,
    screenJob: "展示认证、评价、前后对比等信任证明",
  },
  {
    sliceId: "07",
    buyerQuestion: "与其他产品比较如何？",
    moduleType: "comparison",
    copyPattern: "single_line_with_labels" as CopyStructurePattern,
    screenJob: "展示产品对比优势",
  },
  {
    sliceId: "08",
    buyerQuestion: "为什么现在购买？",
    moduleType: "closing",
    copyPattern: "quiet_closing" as CopyStructurePattern,
    screenJob: "促成最终转化",
  },
];

/** 生成完整页面规划 */
export async function generateBlueprint(request: BlueprintRequest): Promise<PageBlueprint> {
  const {
    productName,
    productCategory,
    targetAudience = "普通消费者",
    sellingPoints,
    prohibitedClaims = [],
    productAttributes,
  } = request;

  // 获取产品属性（如果未提供）
  const attrs = productAttributes || {
    category: productCategory,
    color: "neutral",
    material: "premium",
    style: "modern",
  };

  // 生成卖点种子
  const claimSeeds = sellingPoints || inferClaimSeeds(attrs, productCategory);

  // 生成首屏
  const firstScreen = generateFirstScreen(claimSeeds, productName, attrs);

  // 生成后续屏幕
  const subsequentScreens = SCREEN_TEMPLATES.map((template, index) =>
    generateSubsequentScreen(
      template.sliceId,
      template.buyerQuestion,
      claimSeeds[index % claimSeeds.length],
      template.moduleType,
      template.copyPattern,
      template.screenJob
    )
  );

  // 组合所有屏幕
  const screens = [firstScreen, ...subsequentScreens];

  // 生成视觉DNA
  const visualDNA: VisualDNA = {
    palette: ["#FFFFFF", "#F5F5F5", "#333333"],
    lighting: "柔和影棚光",
    typography: "现代简约",
    rhythm: "强弱交替",
    continuityMotifs: ["产品轮廓", "色彩点缀"],
  };

  // 生成规划
  const blueprint: PageBlueprint = {
    id: crypto.randomUUID(),
    productName,
    productCategory,
    targetAudience,
    claimSeeds,
    screens,
    visualDNA,
    riskAssessment: [
      ...prohibitedClaims.map((c) => `禁止提及: ${c}`),
      "AI推断的卖点需要用户确认",
    ],
    createdAt: Date.now(),
  };

  return blueprint;
}

/** 使用LLM优化规划文案 */
export async function refineBlueprintWithLLM(
  blueprint: PageBlueprint,
  productInfo: string
): Promise<PageBlueprint> {
  const prompt = `你是一个电商详情页规划专家。请为以下产品优化8屏详情页规划。

产品信息：
${productInfo}

当前规划：
${JSON.stringify(blueprint.screens.map((s) => ({
  屏幕: s.sliceId,
  买家问题: s.buyerQuestion,
  卖点种子: s.claimSeed,
  屏幕任务: s.screenJob,
  文案结构: s.copyStructurePattern,
})), null, 2)}

请优化每屏的：
1. 文案结构（确保不重复）
2. 内容密度（有强弱变化）
3. 视觉构图（差异化）

返回JSON格式的优化后规划。`;

  try {
    const response = await Model.chat("orchestrator").ask({ prompt }).run();
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const optimized = JSON.parse(jsonMatch[0]);
      // 合并优化结果
      optimized.forEach((opt: any, index: number) => {
        if (blueprint.screens[index]) {
          blueprint.screens[index] = {
            ...blueprint.screens[index],
            ...opt,
          };
        }
      });
    }
  } catch (e) {
    console.error("[blueprint] LLM优化失败:", e);
  }

  return blueprint;
}

/** 验证规划完整性 */
export function validateBlueprint(blueprint: PageBlueprint): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // 检查卖点种子数量
  if (blueprint.claimSeeds.length < 2) {
    issues.push("卖点种子至少需要2个");
  }

  // 检查屏幕数量
  if (blueprint.screens.length !== 8) {
    issues.push(`屏幕数量应为8个，当前${blueprint.screens.length}个`);
  }

  // 检查文案结构差异化
  const patterns = blueprint.screens.map((s) => s.copyStructurePattern);
  const uniquePatterns = new Set(patterns);
  if (uniquePatterns.size < 5) {
    issues.push("文案结构差异化不足，至少需要5种不同模式");
  }

  // 检查内容密度变化
  const densities = blueprint.screens.map((s) => s.contentDensity);
  const hasHigh = densities.includes("high");
  const hasLow = densities.includes("low");
  if (!hasHigh || !hasLow) {
    issues.push("内容密度应有高低变化");
  }

  // 检查买家问题差异化
  const questions = blueprint.screens.map((s) => s.buyerQuestion);
  const uniqueQuestions = new Set(questions);
  if (uniqueQuestions.size < 6) {
    issues.push("买家问题差异化不足");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
