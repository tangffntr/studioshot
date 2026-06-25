/**
 * server/adapters/agnes-image.ts — Agnes 图片生成适配器
 * 契约来源：官方 curl 示例
 *
 * 端点：POST https://apihub.agnes-ai.com/v1/images/generations（同步返回）
 * 请求：{ model: "agnes-image-2.1-flash", prompt, size, extra_body: { response_format } }
 * 响应：{ created, data: [{ url | b64_json }] }
 */
import type { VendorAdapter, GenImageRequest, GenImageResult } from "./base";
import { withRetry } from "../utils/retry";

export class AgnesImageAdapter implements VendorAdapter {
  category = "image" as const;

  async generateImage(req: GenImageRequest, creds: Record<string, string>): Promise<GenImageResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("Agnes Image 缺少 apiKey");
    const baseUrl = (creds.baseUrl || "https://apihub.agnes-ai.com").replace(/\/+$/, "");

    const size = req.size || "1024x1024";

    // 按官方文档：图生图用 extra_body.image 数组（支持 Data URI Base64），
    // 图生图输出用 extra_body.response_format: "b64_json"；
    // 文生图输出用 extra_body.response_format: "url"（默认）。
    const refs = req.referenceImages || [];
    const isImg2Img = refs.length > 0;

    // 把参考图统一成 Data URI（data:image/png;base64,...）数组
    const imageArray = refs.map((b64) => (b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`));

    const extraBody: Record<string, unknown> = {
      // 图生图用 b64_json 输出（直接拿 base64），文生图用 url 输出
      response_format: isImg2Img ? "b64_json" : "url",
    };
    if (isImg2Img) extraBody.image = imageArray;

    const res = await withRetry(() => fetch(`${baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: req.model || "agnes-image-2.1-flash",
        prompt: req.prompt,
        size,
        extra_body: extraBody,
      }),
    }));

    if (!res.ok) {
      throw new Error(`Agnes Image 生成失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as any;
    const item = data?.data?.[0];
    if (!item) throw new Error(`Agnes Image 未返回图片：${JSON.stringify(data).slice(0, 200)}`);

    let base64 = "";
    let mime = "image/png";

    if (item.b64_json) {
      base64 = item.b64_json;
    } else if (item.url) {
      const imgRes = await withRetry(() => fetch(item.url));
      if (!imgRes.ok) throw new Error(`下载图片失败 ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      base64 = buf.toString("base64");
      mime = imgRes.headers.get("content-type") || "image/png";
    } else {
      throw new Error(`Agnes Image 响应格式异常：${JSON.stringify(data).slice(0, 200)}`);
    }

    return {
      base64,
      mime,
      cost: 10,
      meta: { model: req.model || "agnes-image-2.1-flash", created: data?.created, img2img: isImg2Img },
    };
  }
}
