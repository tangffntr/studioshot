/**
 * server/adapters/grsai.ts — Grsai 适配器（gpt-image-2 图生图）
 * 契约来源：Phase 0 验证 + 官方文档 https://qmy27nhsd9.apifox.cn/452409160e0
 *
 * 端点：POST {host}/v1/api/generate（同步返回）
 * 请求：{ model, prompt, images: [dataurl], aspectRatio, replyType: "json" }
 * 响应：{ id, status: "succeeded", results: [{url}] }
 *
 * 注意：旧版 /v1/draw/completions 图生图会卡死，勿用。
 */
import type { VendorAdapter, GenImageRequest, GenImageResult } from "./base";
import { extractHost } from "./base";
import { withRetry } from "../utils/retry";
import sharp from "sharp";

/**
 * 压缩参考图：长边限制 1024px，输出 JPEG（质量 85），返回纯 base64（不含 data: 前缀）。
 * 避免原图过大（如 1.8MB）导致 grsai "image upload failed"。
 */
async function compressImage(b64: string): Promise<string> {
  // 去掉可能的 data: 前缀
  const raw = b64.includes(",") ? b64.split(",")[1] : b64;
  const buf = Buffer.from(raw, "base64");
  const compressed = await sharp(buf)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return compressed.toString("base64");
}

export class GrsaiAdapter implements VendorAdapter {
  category = "image" as const;

  async generateImage(req: GenImageRequest, creds: Record<string, string>): Promise<GenImageResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("Grsai 缺少 apiKey");
    const baseUrl = creds.baseUrl || "https://grsai.dakka.com.cn";
    const host = extractHost(baseUrl);

    // 构造请求体（图生图传 images 数组）
    // 压缩参考图：长边限制 1024px + JPEG 85%，避免原图过大导致 grsai 上传失败
    const rawImages = req.referenceImages || [];
    const images: string[] = [];
    for (const b64 of rawImages) {
      try {
        const compressed = await compressImage(b64);
        images.push(compressed.startsWith("data:") ? compressed : `data:image/jpeg;base64,${compressed}`);
      } catch {
        // 压缩失败则用原图
        images.push(b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);
      }
    }

    // 直接使用传入的 size（pipeline 已根据 cellSize + gridSize 计算好最终尺寸）
    const aspectRatio = req.size || "1024x1024";

    const res = await withRetry(() => fetch(`${host}/v1/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        images,
        aspectRatio,
        replyType: "json",
      }),
    }));

    if (!res.ok) {
      throw new Error(`Grsai 生成失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as any;
    const url: string | undefined = data?.results?.[0]?.url;
    if (!url) throw new Error(`Grsai 未返回图片：${JSON.stringify(data).slice(0, 200)}`);

    // 下载转 base64（带重试）
    const imgRes = await withRetry(() => fetch(url));
    if (!imgRes.ok) throw new Error(`下载图片失败 ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return {
      base64: buf.toString("base64"),
      mime: "image/png",
      cost: 50, // 单图约 0.5 元（分），按实际计价调整
      meta: { taskId: data?.id, status: data?.status },
    };
  }
}
