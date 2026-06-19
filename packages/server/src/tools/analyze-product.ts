/**
 * server/tools/analyze-product.ts — VLM 看图分析产品属性
 * 调 Model.chat 门面（VLM），返回结构化属性 JSON。
 */
import { make, type Content } from "./tool";
import { Model } from "../model-manager/facade";
import { readMediaBase64 } from "./generate-image";
import { AnalyzeProductInput, type AnalyzeProductOutput } from "@ecom/shared";

const ANALYZE_PROMPT = `你是一个电商产品分析专家。请分析这张产品图，输出严格的 JSON：
{
  "category": "产品类目（如 服饰/3C数码/美妆/家居/食品）",
  "attributes": { "color": "主色", "material": "材质", "shape": "形状", "style": "风格" },
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "description": "一段话产品描述"
}
只输出 JSON，不要其他文字。`;

export const analyzeProductTool = make<{ mediaId: string }, AnalyzeProductOutput>(
  "analyze_product",
  {
    description: "分析产品图：识别类目、颜色、材质、卖点等属性。返回结构化 JSON。在生成图片前应先分析产品。",
    input: AnalyzeProductInput,
    async execute(input, ctx) {
      const imgB64 = await readMediaBase64(input.mediaId);
      const text = await Model.chat("vlm").ask({ prompt: ANALYZE_PROMPT, images: [imgB64] }).run();
      const jsonStr = text.replace(/```json\n?|\n?```/g, "").trim();
      try {
        const parsed = JSON.parse(jsonStr);
        ctx.emit({ type: "tool.result", jobId: ctx.jobId, toolName: "analyze_product", toolResult: parsed });
        return parsed as AnalyzeProductOutput;
      } catch {
        return { category: "未知", attributes: {}, sellingPoints: [], description: text } as AnalyzeProductOutput;
      }
    },
    toModelOutput(_input, output): Content[] {
      return [{ type: "text", text: `产品分析结果：\n${JSON.stringify(output, null, 2)}` }];
    },
  }
);
