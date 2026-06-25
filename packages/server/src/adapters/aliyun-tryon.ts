/**
 * server/adapters/aliyun-tryon.ts — 阿里云 OutfitAnyone 虚拟试穿适配器
 *
 * 契约来源：Phase 0 调研 + 阿里云百炼文档
 *   POST https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis
 *   异步：提交得 task_id → GET 轮询 → image_url
 *
 * 约束：阿里云要求 person_image_url / top_garment_url 为公网 URL（非 base64）。
 * 优先上传腾讯云 COS 换公网 URL；COS 未配置时降级用 base64 data url（阿里云可能拒绝）。
 */
import type { VendorAdapter } from "./base";
import { withRetry } from "../utils/retry";
import { uploadImageBase64ToCos, isCosConfigured } from "../storage/cos";

export interface TryonRequest {
  personImageBase64: string; // 模特正面全身照
  topGarmentBase64?: string; // 上装平铺图
  bottomGarmentBase64?: string; // 下装平铺图
}

export interface TryonResult {
  base64: string;
  mime: string;
  cost: number;
}

export class AliyunTryonAdapter implements VendorAdapter {
  category = "tryon" as const;

  // 注：VendorAdapter 接口的 generateImage/chat 不适用试穿，这里用独立方法
  async tryon(req: TryonRequest, creds: Record<string, string>): Promise<TryonResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("阿里云试穿缺少 apiKey（DASHSCOPE_API_KEY）");
    const baseUrl = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis";

    // 构造请求：阿里云要求公网 URL。
    // 优先上传 COS 换公网 URL；COS 未配置时降级用 data url（阿里云可能拒绝）。
    const toUrl = async (b64: string): Promise<string> => {
      if (isCosConfigured()) {
        try { return await uploadImageBase64ToCos(b64, "png"); }
        catch (e: any) { console.error("[tryon] 上传 COS 失败，降级 data url:", e.message); }
      }
      return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
    };
    const personUrl = await toUrl(req.personImageBase64);
    const body: Record<string, unknown> = {
      model: "aitryon",
      input: {
        person_image_url: personUrl,
      },
      parameters: { resolution: -1, restore_face: true },
    };
    if (req.topGarmentBase64) (body.input as any).top_garment_url = await toUrl(req.topGarmentBase64);
    if (req.bottomGarmentBase64) (body.input as any).bottom_garment_url = await toUrl(req.bottomGarmentBase64);

    // 1. 提交任务
    const submitRes = await withRetry(() => fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(body),
    }));
    if (!submitRes.ok) throw new Error(`试穿提交失败 ${submitRes.status}: ${(await submitRes.text()).slice(0, 200)}`);
    const submitData = await submitRes.json() as any;
    const taskId = submitData?.output?.task_id;
    if (!taskId) throw new Error(`试穿未返回 task_id: ${JSON.stringify(submitData).slice(0, 200)}`);

    // 2. 轮询（15-30s，每 4s）
    const queryUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
    const start = Date.now();
    let imageUrl: string | undefined;
    while (Date.now() - start < 120000) {
      await new Promise((r) => setTimeout(r, 4000));
      const pollRes = await fetch(queryUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      const pollData = await pollRes.json() as any;
      const status = pollData?.output?.task_status;
      if (status === "FAILED") throw new Error(`试穿失败: ${pollData?.output?.message || ""}`);
      if (status === "SUCCEEDED") { imageUrl = pollData?.output?.image_url; break; }
    }
    if (!imageUrl) throw new Error("试穿轮询超时");

    // 3. 下载
    const imgRes = await withRetry(() => fetch(imageUrl!));
    if (!imgRes.ok) throw new Error(`下载试穿图失败 ${imgRes.status}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return { base64: buf.toString("base64"), mime: "image/png", cost: 20 }; // 0.20元/张
  }
}
