/**
 * server/adapters/agnes-video.ts — Agnes 视频生成适配器
 * 契约来源：官方《Agnes-Video-V2.0 API 接入指南》
 *
 * 提交：POST https://apihub.agnes-ai.com/v1/videos（异步，返回 video_id + task_id）
 * 轮询：GET  https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>（推荐，间隔 5s）
 *       GET  https://apihub.agnes-ai.com/v1/videos/{task_id}（兼容旧方式）
 *
 * 帧数约束：num_frames ≤ 441 且 = 8n+1（合法值 81/121/161/241/281/321/361/401/441）
 * 状态：queued / in_progress / completed / failed
 * 视频 URL：data.remixed_from_video_id（仅 completed 时）
 *
 * 注意：图生视频/多图视频需要"可公网访问的图片 URL"（官方明确，不支持 base64）。
 *       首帧/参考图会先上传腾讯云 COS 换取公网 URL，再传给 agnes。
 */
import type { VendorAdapter } from "./base";
import { withRetry } from "../utils/retry";
import { uploadImageBase64ToCos } from "../storage/cos";

export interface AgnesVideoRequest {
  prompt: string;
  duration?: number;       // 目标秒数（会被映射到 num_frames + frame_rate）
  aspectRatio?: string;    // 16:9 / 9:16 / 1:1 等
  model?: string;
  firstFrameBase64?: string; // 图生视频首帧（需公网 URL，本地 base64 暂不支持）
  referenceImages?: string[]; // 多图视频（需公网 URL）
}

export interface AgnesVideoResult {
  videoUrl: string;
  cost: number;
}

/** 宽高比 → 推荐宽高（720p 档） */
function dimsFromAspectRatio(ratio?: string): { width: number; height: number } {
  switch ((ratio || "16:9").replace(/\s/g, "")) {
    case "9:16": return { width: 720, height: 1280 };
    case "1:1": return { width: 720, height: 720 };
    case "4:3": return { width: 960, height: 720 };
    case "3:4": return { width: 720, height: 960 };
    case "16:9":
    default: return { width: 1280, height: 720 };
  }
}

/** 秒数 → 合法的 num_frames（满足 8n+1 ≤ 441）+ frame_rate=24 */
function framesFromDuration(duration: number): { num_frames: number; frame_rate: number } {
  const frameRate = 24;
  // 目标 num_frames = duration * frameRate，再向上对齐到最近的 8n+1
  const target = Math.round(duration * frameRate);
  const legal = [81, 121, 161, 201, 241, 281, 321, 361, 401, 441];
  // 取不超过 441 且最接近 target 的合法值
  let best = legal[0];
  for (const f of legal) {
    if (Math.abs(f - target) < Math.abs(best - target)) best = f;
  }
  return { num_frames: Math.min(best, 441), frame_rate: frameRate };
}

export class AgnesVideoAdapter implements VendorAdapter {
  category = "video" as const;

  async generateVideo(req: AgnesVideoRequest, creds: Record<string, string>): Promise<AgnesVideoResult> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("Agnes Video 缺少 apiKey");
    const baseUrl = (creds.baseUrl || "https://apihub.agnes-ai.com").replace(/\/+$/, "");

    const model = req.model || "agnes-video-v2.0";
    const { width, height } = dimsFromAspectRatio(req.aspectRatio);
    const { num_frames, frame_rate } = framesFromDuration(req.duration || 5);

    // 图生视频：把首帧/参考图上传 COS 拿公网 URL（agnes 不支持 base64，需公网 URL）。
    // - 单首帧（图生视频）：放顶层 image 字段
    // - 多参考图（多图视频）：放 extra_body.image 数组
    const imageUrls: string[] = [];
    if (req.firstFrameBase64) {
      try {
        const url = await uploadImageBase64ToCos(req.firstFrameBase64, "png");
        imageUrls.push(url);
        console.log(`[agnes-video] 首帧已上传 COS: ${url.slice(0, 60)}...`);
      } catch (e: any) {
        console.error(`[agnes-video] 首帧上传 COS 失败，降级文生视频:`, e.message);
      }
    }
    if (req.referenceImages && req.referenceImages.length > 0) {
      for (const b64 of req.referenceImages) {
        try { imageUrls.push(await uploadImageBase64ToCos(b64, "png")); }
        catch (e: any) { console.error(`[agnes-video] 参考图上传 COS 失败:`, e.message); }
      }
    }

    // 1. 提交任务（POST /v1/videos）
    const submitBody: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      width,
      height,
      num_frames,
      frame_rate,
    };
    // 图生视频：单图用顶层 image，多图用 extra_body.image 数组
    if (imageUrls.length === 1) {
      submitBody.image = imageUrls[0];
    } else if (imageUrls.length > 1) {
      submitBody.extra_body = { image: imageUrls };
    }

    const submitRes = await withRetry(() => fetch(`${baseUrl}/v1/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(submitBody),
    }));
    if (!submitRes.ok) throw new Error(`Agnes Video 提交失败 ${submitRes.status}: ${(await submitRes.text()).slice(0, 200)}`);
    const submitData = await submitRes.json() as any;

    // 官方推荐用 video_id 查询；兼容旧 task_id
    const videoId = submitData?.video_id;
    const taskId = submitData?.task_id || submitData?.id;
    if (!videoId && !taskId) throw new Error(`Agnes Video 未返回 video_id/task_id: ${JSON.stringify(submitData).slice(0, 200)}`);
    console.log(`[agnes-video] 提交成功 video_id=${videoId} task_id=${taskId}`);

    // 2. 轮询（推荐 video_id 查询，间隔 5s，最长 5 分钟）
    const pollUrl = videoId
      ? `${baseUrl}/agnesapi?video_id=${videoId}`
      : `${baseUrl}/v1/videos/${taskId}`;
    const start = Date.now();
    let videoUrl: string | undefined;

    while (Date.now() - start < 300000) {
      await new Promise((r) => setTimeout(r, 5000));
      const pollRes = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json() as any;

      // 官方状态：queued / in_progress / completed / failed
      const status = pollData?.status;
      const progress = pollData?.progress;
      console.log(`[agnes-video] ${videoId || taskId} status=${status} progress=${progress}`);

      if (status === "failed" || status === "FAIL" || status === "FAILED") {
        throw new Error(`Agnes Video 生成失败: ${pollData?.error || JSON.stringify(pollData).slice(0, 200)}`);
      }
      if (status === "completed" || status === "SUCCESS" || status === "COMPLETED") {
        // 官方：视频 URL 在 remixed_from_video_id 字段
        videoUrl = pollData?.remixed_from_video_id || pollData?.video_url || pollData?.data?.video_url;
        if (videoUrl) break;
      }
    }
    if (!videoUrl) throw new Error("Agnes Video 轮询超时（5分钟）");
    return { videoUrl, cost: Math.ceil((req.duration || 5) * 0.5) };
  }
}
