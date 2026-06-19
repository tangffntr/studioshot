/**
 * @ecom/shared — 工具输入 Zod schema（§3.3）
 * 这些 schema 自动转 JSON Schema 喂给主 LLM，决定它能调哪些工具、传什么参数。
 * MVP 最小闭环只需 3 个工具（§5.2）。
 */
import { z } from "zod";

/** analyze-product：VLM 看图分析产品属性 */
export const AnalyzeProductInput = z.object({
  mediaId: z.string().describe("待分析的产品图 media id"),
});
export type AnalyzeProductInput = z.infer<typeof AnalyzeProductInput>;

export const AnalyzeProductOutput = z.object({
  category: z.string().describe("产品类目，如 服饰/3C/美妆"),
  attributes: z.record(z.string(), z.unknown()).describe("SKU 属性：颜色/材质/款式等"),
  sellingPoints: z.array(z.string()).describe("提炼的卖点清单"),
  description: z.string().describe("一段话产品描述"),
});
export type AnalyzeProductOutput = z.infer<typeof AnalyzeProductOutput>;

/** generate-image：生图（图生图保真 / 纯文生图） */
export const GenerateImageInput = z.object({
  prompt: z.string().describe("图片生成 prompt"),
  referenceMediaIds: z.array(z.string()).describe("参考产品图 media id（图生图保真；空数组=纯文生图）").default([]),
  size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).describe("输出尺寸").default("1024x1024"),
  purpose: z.string().describe("这张图的用途，便于审计与主 LLM 决策"),
});
export type GenerateImageInput = z.infer<typeof GenerateImageInput>;

export const GenerateImageOutput = z.object({
  mediaId: z.string().describe("生成的 media id"),
  filePath: z.string(),
  base64: z.string().describe("base64（用于回灌主 LLM 让它看回）"),
  mime: z.string(),
  filename: z.string(),
});
export type GenerateImageOutput = z.infer<typeof GenerateImageOutput>;

/** check-quality：VLM 质检生成图 */
export const CheckQualityInput = z.object({
  mediaId: z.string().describe("待检查的 media id"),
  criteria: z.array(z.string()).describe("检查项，如 logo保真/文字清晰/产品完整").default(["产品外观保真", "文字清晰"]),
});
export type CheckQualityInput = z.infer<typeof CheckQualityInput>;

export const CheckQualityOutput = z.object({
  score: z.number().min(0).max(1).describe("综合评分 0-1"),
  passed: z.boolean(),
  issues: z.array(z.string()).describe("发现的问题"),
});
export type CheckQualityOutput = z.infer<typeof CheckQualityOutput>;

/** 工具内容部分（回灌主 LLM，对应 opencode tool.ts Content） */
export const ToolContent = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("file"), data: z.string(), mime: z.string(), name: z.string().optional() }),
]);
export type ToolContent = z.infer<typeof ToolContent>;
