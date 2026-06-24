/**
 * server/adapters/agnes-video.ts — Agnes 视频生成适配器
 * 契约来源：官方 API
 *
 * 提交：POST https://apihub.agnes-ai.com/v1/video/generations（异步）
 * 轮询：GET  https://apihub.agnes-ai.com/v1/video/generations/{taskId}
 */
import type { VendorAdapter } from "./base";
import { withRetry } from "../utils/retry";

export interface AgnesVideoRequest {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  model?: string;
}

export interface AgnesVideoResult {
  videoUrl: string;
  cost: number;
}

export class AgnesVideoAdapter implements VendorAdapter {
  category = "video" as const;

  async generateVideo(req: AgnesVideoRequest, creds: Record<string, string>): Promise<AgnesVideoResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("Agnes Video 缺少 apiKey");
    const baseUrl = (creds.baseUrl || "https://apihub.agnes-ai.com").replace(/\/+$/, "");

    const model = req.model || "agnes-video-v2.0";
    const duration = req.duration || 4;

    // 1. 提交任务
    const submitRes = await withRetry(() => fetch(`${baseUrl}/v1/video/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        prompt: req.prompt,
        model,
        duration,
      }),
    }));
    if (!submitRes.ok) throw new Error(`Agnes Video 提交失败 ${submitRes.status}: ${(await submitRes.text()).slice(0, 200)}`);
    const submitData = await submitRes.json() as any;

    const taskId = submitData?.task_id;
    if (!taskId) throw new Error(`Agnes Video 未返回 task_id: ${JSON.stringify(submitData).slice(0, 200)}`);

    // 2. 轮询（每 15s 查一次，最长 5 分钟）
    const pollUrl = `${baseUrl}/v1/video/generations/${taskId}`;
    const start = Date.now();
    let videoUrl: string | undefined;

    while (Date.now() - start < 300000) {
      await new Promise((r) => setTimeout(r, 15000));
      const pollRes = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json() as any;

      const status = pollData?.data?.status;
      const progress = pollData?.data?.progress || "";

      if (status === "FAIL" || status === "FAILED") {
        throw new Error(`Agnes Video 生成失败: ${pollData?.data?.fail_reason || JSON.stringify(pollData).slice(0, 200)}`);
      }
      if (status === "SUCCESS" || status === "COMPLETED") {
        // 从 data.data 中提取视频 URL
        const output = pollData?.data?.data;
        videoUrl = output?.output?.video_url || output?.video_url || pollData?.data?.video_url;
        if (videoUrl) break;
        // 如果没有直接的 URL，可能在 output 的其他字段中
        if (typeof output === "object" && output !== null) {
          for (const v of Object.values(output)) {
            if (typeof v === "string" && v.startsWith("http") && (v.includes(".mp4") || v.includes("video"))) {
              videoUrl = v;
              break;
            }
          }
        }
        if (videoUrl) break;
      }
      console.log(`[agnes-video] ${taskId} status=${status} progress=${progress}`);
    }
    if (!videoUrl) throw new Error("Agnes Video 轮询超时（5分钟）");
    return { videoUrl, cost: Math.ceil(duration * 0.5) };
  }
}
