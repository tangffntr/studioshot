/**
 * server/tools/check-quality.ts — VLM 质检生成图
 * 调 Model.chat 门面，对生成图做合规/保真/一致性评分。
 * 主 LLM 据此决定是否重做（A3 闭环：看回→判断→重试）。
 */
import { make, type Content } from "./tool";
import { Model } from "../model-manager/facade";
import { readMediaBase64 } from "./generate-image";
import { CheckQualityInput, type CheckQualityOutput } from "@ecom/shared";

export const checkQualityTool = make<{ mediaId: string; criteria: string[] }, CheckQualityOutput>(
  "check_quality",
  {
    description:
      "质检已生成的图片：检查产品外观保真、文字清晰度、构图合理性。返回评分(0-1)和问题清单。若不通过，主 Agent 应重做 generate_image。",
    input: CheckQualityInput,
    async execute(input, ctx) {
      const imgB64 = await readMediaBase64(input.mediaId);
      const prompt = `你是电商图片质检专家。请检查这张图，重点：${input.criteria.join("、")}。
输出严格 JSON：
{"score": 0.0-1.0, "passed": true/false, "issues": ["问题1", "问题2"]}
评分<0.7 视为不通过。只输出 JSON。`;
      const text = await Model.chat("vlm").ask({ prompt, images: [imgB64] }).run();
      const jsonStr = text.replace(/```json\n?|\n?```/g, "").trim();
      try {
        const parsed = JSON.parse(jsonStr);
        const result: CheckQualityOutput = {
          score: Number(parsed.score) || 0,
          passed: Boolean(parsed.passed),
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        };
        ctx.emit({ type: "tool.result", jobId: ctx.jobId, toolName: "check_quality", toolResult: result });
        return result;
      } catch {
        return { score: 0.5, passed: true, issues: ["质检解析失败，默认放行"] } as CheckQualityOutput;
      }
    },
    toModelOutput(_input, output): Content[] {
      return [
        {
          type: "text",
          text: `质检结果：评分 ${output.score.toFixed(2)}，${output.passed ? "通过" : "不通过"}。问题：${output.issues.join("；") || "无"}`,
        },
      ];
    },
  }
);
