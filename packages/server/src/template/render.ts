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
