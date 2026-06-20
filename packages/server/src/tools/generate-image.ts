/**
 * server/tools/generate-image.ts — 生图工具
 * 调 Model.image 门面，toModelOutput 返回 file（base64+mime）让主 LLM 看回图。
 * ⭐ 这是 A3 假设的工程落地点（§5.3）。
 */
import { make, type Content } from "./tool";
import { Model } from "../model-manager/facade";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import * as crypto from "node:crypto";
import { GenerateImageInput } from "@ecom/shared";
import type { GenerateImageOutput } from "@ecom/shared";

/** 从 mediaId 读图片 base64（供参考图） */
export async function readMediaBase64(mediaId: string): Promise<string> {
  const db = getDb();
  const m = db.select().from(media).where(eq(media.id, mediaId)).all()[0];
  if (!m) throw new Error(`media ${mediaId} 不存在`);
  return await oss.getImageBase64(m.filePath);
}

export const generateImageTool = make<{ prompt: string; referenceMediaIds: string[]; size: string; purpose: string }, GenerateImageOutput>(
  "generate_image",
  {
    description:
      "生成电商图（主图/场景图）。传入 prompt 和可选参考产品图（图生图保真）。生成后你会看到结果图，可判断是否需要重做。",
    input: GenerateImageInput,
    async execute(input, ctx) {
      // 读参考图
      const refs: string[] = [];
      for (const mid of input.referenceMediaIds) {
        refs.push(await readMediaBase64(mid));
      }
      const productId = ctx.productId;
      const fileId = crypto.randomUUID();
      const filePath = `/${productId || "tmp"}/image/${fileId}.png`;

      // Model.image 链式门面：generate → run（调适配器）→ save（落 OSS + 建 media）
      const facade = Model.image("main-image").generate({
        prompt: input.prompt,
        referenceImages: refs,
        size: input.size,
      });
      await facade.run();
      const result = await facade.save(filePath, productId, input.prompt, ctx.jobId);

      return {
        mediaId: result.mediaId,
        filePath: result.filePath,
        base64: result.base64,
        mime: result.mime,
        filename: `${fileId}.png`,
      } as GenerateImageOutput;
    },
    toModelOutput(input, output): Content[] {
      return [
        { type: "text", text: `已生成 ${input.purpose}：${output.mediaId}` },
        { type: "file", data: output.base64, mime: output.mime, name: output.filename },
      ];
    },
  }
);
