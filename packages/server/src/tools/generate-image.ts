/**
 * server/tools/generate-image.ts — 生图工具
 * 调 Model.image 门面，toModelOutput 返回 file（base64+mime）让主 LLM 看回图。
 * ⭐ 这是 A3 假设的工程落地点（§5.3）。
 */
import { make, type Content } from "./tool";
import { Model } from "../model-manager/facade";
import { getDb } from "../db/client";
import { media, materials } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import * as crypto from "node:crypto";
import { GenerateImageInput } from "@ecom/shared";
import type { GenerateImageOutput } from "@ecom/shared";

/**
 * 从 id 读图片 base64（供参考图）。
 * id 可以是 media.id，也可以是 materials.id（素材库素材）：
 *   - 先查 media 表，命中则用其 filePath 读图；
 *   - 再查 materials 表，命中则用其 filePath 读图。
 * materials.id 与 media.id 都是 UUID，互不冲突，统一 id 空间查找安全。
 * 这样无需为素材单独建 media 记录即可作为参考图。
 */
export async function readMediaBase64(id: string): Promise<string> {
  const db = getDb();
  // 1. 优先查 media 表（产品图/生成图）
  const m = db.select().from(media).where(eq(media.id, id)).all()[0];
  if (m) return await oss.getImageBase64(m.filePath);
  // 2. 回退查 materials 表（素材库素材）
  const mat = db.select().from(materials).where(eq(materials.id, id)).all()[0];
  if (mat?.filePath) return await oss.getImageBase64(mat.filePath);
  throw new Error(`图片 ${id} 不存在（media / materials 表均未找到）`);
}

export const generateImageTool = make<{ prompt: string; referenceMediaIds: string[]; size: string; purpose: string }, GenerateImageOutput>(
  "generate_image",
  {
    description:
      "生成电商图（主图/场景图）。传入 prompt 和可选参考产品图（图生图保真）。生成后你会看到结果图，可判断是否需要重做。",
    input: GenerateImageInput,
    async execute(input, ctx) {
      // 读参考图（无图时 referenceMediaIds 可能为空，兜底空数组）
      const refs: string[] = [];
      for (const mid of input.referenceMediaIds || []) {
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
