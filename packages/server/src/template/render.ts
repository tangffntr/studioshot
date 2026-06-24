/**
 * server/template/render.ts — Prompt 渲染器（纯字符串模板拼接）
 *
 * 把模板图位的 promptSkeleton（含 {color}{material}{category} 占位）
 * 填充为最终 prompt。纯函数，无 LLM 调用（省时省钱）。
 *
 * 属性来源：analyze_product 工具返回的 attributes 对象。
 * 占位规则：{key} 替换为 attributes[key]，缺失则替换为通用占位 "product"。
 */
import type { TemplateSlot } from "@ecom/shared";
import type { PageBlueprint, ScreenPlan } from "@ecom/shared";

/** 产品属性（analyze_product 产出，松散结构） */
export type ProductAttributes = {
  category?: string;
  color?: string;
  material?: string;
  shape?: string;
  style?: string;
  [key: string]: string | undefined;
};

/** 渲染单个 prompt：替换 {key} 占位 */
export function renderPrompt(skeleton: string, attrs: ProductAttributes): string {
  return skeleton.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const val = attrs[key];
    if (val && val.trim()) return val.trim();
    // 缺失属性的兜底
    const fallbacks: Record<string, string> = {
      color: "neutral",
      material: "premium",
      category: "product",
      shape: "modern",
      style: "minimalist",
    };
    return fallbacks[key] || "product";
  });
}

/** 渲染结果（含 slot 元信息，供 Pipeline 使用） */
export interface RenderedSlot {
  slot: TemplateSlot;
  prompt: string;
  size: string;
  /** 卖点种子（首屏建立，后续屏幕展开） */
  claimSeed?: string;
  /** 屏幕规划（如果有） */
  screenPlan?: ScreenPlan;
}

/** 渲染模板全部图位 */
export function renderAllSlots(
  slots: TemplateSlot[],
  attrs: ProductAttributes
): RenderedSlot[] {
  return slots.map((slot) => ({
    slot,
    prompt: renderPrompt(slot.promptSkeleton, attrs),
    size: slot.sizePreset || "1024x1024",
  }));
}

/** 基于页面规划渲染模板全部图位（带卖点种子） */
export function renderAllSlotsWithBlueprint(
  slots: TemplateSlot[],
  attrs: ProductAttributes,
  blueprint: PageBlueprint
): RenderedSlot[] {
  return slots.map((slot, index) => {
    const screenPlan = blueprint.screens[index];
    const basePrompt = renderPrompt(slot.promptSkeleton, attrs);

    // 如果有屏幕规划，注入卖点种子
    let prompt = basePrompt;
    if (screenPlan) {
      // 首屏：建立卖点种子
      if (index === 0) {
        prompt = injectClaimSeeds(prompt, blueprint.claimSeeds, true);
      } else {
        // 后续屏幕：展开卖点种子
        prompt = injectClaimSeeds(prompt, [screenPlan.claimSeed], false);
      }
    }

    return {
      slot,
      prompt,
      size: slot.sizePreset || "1024x1024",
      claimSeed: screenPlan?.claimSeed,
      screenPlan,
    };
  });
}

/** 注入卖点种子到prompt */
function injectClaimSeeds(
  prompt: string,
  claimSeeds: string[],
  isFirstScreen: boolean
): string {
  if (claimSeeds.length === 0) return prompt;

  // 检查prompt中是否已经有卖点相关内容
  const hasClaimContent = claimSeeds.some((seed) =>
    prompt.toLowerCase().includes(seed.toLowerCase())
  );

  if (hasClaimContent) return prompt;

  // 首屏：强调核心卖点
  if (isFirstScreen) {
    const seedsText = claimSeeds.join("、");
    return `${prompt}\n\n核心卖点：${seedsText}。突出展示这些卖点。`;
  }

  // 后续屏幕：展开特定卖点
  return `${prompt}\n\n本屏重点展开：${claimSeeds[0]}。`;
}

/** 生成首屏prompt（带完整卖点种子） */
export function generateFirstScreenPrompt(
  slot: TemplateSlot,
  attrs: ProductAttributes,
  claimSeeds: string[],
  productName: string
): string {
  const basePrompt = renderPrompt(slot.promptSkeleton, attrs);

  const seedsText = claimSeeds.join("、");
  return `${basePrompt}\n\n首屏要求：
- 产品名称：${productName}
- 核心卖点：${seedsText}
- 建立产品身份，展示核心价值
- 为后续屏幕奠定叙事基础`;
}

/** 生成后续屏幕prompt（展开卖点种子） */
export function generateSubsequentScreenPrompt(
  slot: TemplateSlot,
  attrs: ProductAttributes,
  claimSeed: string,
  screenJob: string,
  screenIndex: number
): string {
  const basePrompt = renderPrompt(slot.promptSkeleton, attrs);

  return `${basePrompt}\n\n屏幕${screenIndex + 1}要求：
- 展开卖点：${claimSeed}
- 屏幕任务：${screenJob}
- 延续首屏的视觉风格和叙事
- 不要引入新的无关卖点`;
}

/** 验证卖点种子连续性 */
export function validateClaimSeedContinuity(
  renderedSlots: RenderedSlot[],
  blueprint: PageBlueprint
): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // 检查首屏是否建立了卖点种子
  const firstScreen = renderedSlots[0];
  if (!firstScreen.claimSeed) {
    issues.push("首屏未建立卖点种子");
  }

  // 检查后续屏幕是否展开了卖点种子
  for (let i = 1; i < renderedSlots.length; i++) {
    const slot = renderedSlots[i];
    if (!slot.claimSeed) {
      issues.push(`屏幕${i + 1}未指定卖点种子`);
    }
  }

  // 检查卖点种子是否来自首屏
  const firstScreenSeeds = blueprint.claimSeeds;
  for (let i = 1; i < renderedSlots.length; i++) {
    const slot = renderedSlots[i];
    if (slot.claimSeed) {
      const isFromFirstScreen = firstScreenSeeds.some((seed) =>
        slot.claimSeed?.includes(seed) || seed.includes(slot.claimSeed || "")
      );
      if (!isFromFirstScreen) {
        issues.push(`屏幕${i + 1}的卖点"${slot.claimSeed}"不是来自首屏种子`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

