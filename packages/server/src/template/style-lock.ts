/**
 * server/template/style-lock.ts — Campaign Style Lock
 *
 * 可行性报告 §6.4：多图任务先产出一段风格锁定文本（色板/冷暖调/光线/布局），
 * 拼到每张图 prompt 开头，保证整套图视觉一致。
 *
 * 纯逻辑生成（不调 LLM，省积分）。基于产品属性 + 平台规则产出固定风格描述。
 */
import type { ProductAttributes } from "./render";

/** 生成 Campaign Style Lock 文本 */
export function generateStyleLock(attrs: ProductAttributes, platform?: string): string {
  const color = attrs.color || "neutral";
  const parts: string[] = [];

  // 色板（基于产品主色 + 中性背景）
  parts.push(`Consistent color palette: primary product color ${color}, neutral white/light-gray background, single accent color for highlights.`);

  // 冷暖调（按平台/默认）
  const warm = platform === "taobao" || platform === "douyin";
  parts.push(warm ? "Warm tone throughout the set." : "Neutral to cool tone, clean and professional.");

  // 光线
  parts.push("Consistent soft studio lighting from upper-left, soft shadows, no harsh highlights.");

  // 布局
  parts.push("Consistent composition: product centered or rule-of-thirds, ample negative space.");

  // 背景
  parts.push("Consistent minimal background across all images in the set.");

  return "[STYLE LOCK: " + parts.join(" ") + "] ";
}

/** 把 Style Lock 注入到一组渲染后的 prompt 开头 */
export function applyStyleLock(rendered: Array<{ prompt: string }>, styleLock: string): void {
  for (const r of rendered) {
    if (!r.prompt.startsWith("[STYLE LOCK")) {
      r.prompt = styleLock + r.prompt;
    }
  }
}
