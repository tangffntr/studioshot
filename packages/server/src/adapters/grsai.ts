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

export class GrsaiAdapter implements VendorAdapter {
  category = "image" as const;

  async generateImage(req: GenImageRequest, creds: Record<string, string>): Promise<GenImageResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("Grsai 缺少 apiKey");
    const baseUrl = creds.baseUrl || "https://grsai.dakka.com.cn";
    const host = extractHost(baseUrl);

    // 构造请求体（图生图传 images 数组）
    const images = (req.referenceImages || []).map((b64) => (b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`));

    const res = await fetch(`${host}/v1/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        images,
        aspectRatio: req.size || "1024x1024",
        replyType: "json",
      }),
    });

    if (!res.ok) {
      throw new Error(`Grsai 生成失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as any;
    const url: string | undefined = data?.results?.[0]?.url;
    if (!url) throw new Error(`Grsai 未返回图片：${JSON.stringify(data).slice(0, 200)}`);

    // 下载转 base64
    const imgRes = await fetch(url);
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
