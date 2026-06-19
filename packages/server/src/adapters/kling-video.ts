/**
 * server/adapters/kling-video.ts — 可灵视频生成适配器
 *
 * 契约来源：Phase 0 调研（可灵开放平台，图生视频/文生视频，异步轮询）
 *   POST https://api.klingai.com/v1/videos/text2video（文生）/ image2video（图生）
 *   GET https://api.klingai.com/v1/videos/query/{task_id}
 *
 * 可灵支持图生视频（首帧）、参考生视频（多图一致性）——适合电商商品视频。
 */
import type { VendorAdapter } from "./base";
import { withRetry } from "../utils/retry";

export interface VideoRequest {
  prompt: string;
  /** 首帧图 base64（图生视频；空=纯文生视频） */
  firstFrameBase64?: string;
  duration?: number; // 秒，默认 5
  aspectRatio?: string; // "16:9" | "9:16"
}

export interface VideoResult {
  /** 视频 URL（可灵返回 CDN 链接） */
  videoUrl: string;
  /** 视频下载后的本地路径（由调用方存 OSS） */
  cost: number;
}

export class KlingVideoAdapter implements VendorAdapter {
  category = "video" as const;

  async generateVideo(req: VideoRequest, creds: Record<string, string>): Promise<VideoResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("可灵视频缺少 apiKey");
    const baseUrl = (creds.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    const duration = req.duration || 5;
    const aspectRatio = req.aspectRatio || "16:9";

    // 选择端点：有首帧=图生视频，无=文生视频
    const endpoint = req.firstFrameBase64 ? "/v1/videos/image2video" : "/v1/videos/text2video";
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      duration,
      aspect_ratio: aspectRatio,
    };
    if (req.firstFrameBase64) {
      body.image = req.firstFrameBase64.startsWith("data:") ? req.firstFrameBase64 : `data:image/png;base64,${req.firstFrameBase64}`;
    }

    // 1. 提交
    const submitRes = await withRetry(() => fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }));
    if (!submitRes.ok) throw new Error(`视频提交失败 ${submitRes.status}: ${(await submitRes.text()).slice(0, 200)}`);
    const submitData = await submitRes.json() as any;
    const taskId = submitData?.data?.task_id || submitData?.task_id;
    if (!taskId) throw new Error(`视频未返回 task_id: ${JSON.stringify(submitData).slice(0, 200)}`);

    // 2. 轮询（视频生成较慢，60-180s，每 8s）
    const queryUrl = `${baseUrl}/v1/videos/query/${taskId}`;
    const start = Date.now();
    let videoUrl: string | undefined;
    while (Date.now() - start < 300000) { // 最长 5 分钟
      await new Promise((r) => setTimeout(r, 8000));
      const pollRes = await fetch(queryUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      const pollData = await pollRes.json() as any;
      const status = pollData?.data?.task_status || pollData?.task_status;
      if (status === "fail" || status === "failed") throw new Error(`视频生成失败: ${JSON.stringify(pollData).slice(0, 200)}`);
      if (status === "succeed" || status === "success") {
        videoUrl = pollData?.data?.videos?.[0]?.url || pollData?.data?.video_result?.[0]?.url;
        if (videoUrl) break;
      }
    }
    if (!videoUrl) throw new Error("视频轮询超时");
    return { videoUrl, cost: Math.ceil(duration * 0.8) }; // 约 0.8 元/秒
  }
}
