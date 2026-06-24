/**
 * server/agent/video.ts — 视频生成任务
 *
 * 流程：
 *   1. VLM 分析产品图 → 提取产品特征
 *   2. 结合用户指令 + 产品特征 → 生成专业视频 prompt
 *   3. 调用视频生成 API
 *   4. 下载视频存 OSS + 入库
 */
import * as crypto from "node:crypto";
import { getDb } from "../db/client";
import { media, jobs, vendorCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { getAdapter } from "../adapters/registry";
import { decryptCredentials } from "../model-manager/credentials";
import { resolveSlot } from "../model-manager/task-slots";
import { Model } from "../model-manager/facade";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";

function emit(type: EventType, payload: Record<string, unknown>) {
  if (type === ("job.progress" as EventType) && payload.jobId && typeof payload.progress === "number") {
    getDb().update(jobs).set({ progress: payload.progress as number }).where(eq(jobs.id, payload.jobId as string)).run();
  }
  eventBus.publish({ type, ...payload } as SseEvent);
}

const VIDEO_PROMPT_TEMPLATE = `你是一个专业的电商视频导演。根据以下产品信息和用户需求，生成一段视频的描述 prompt。

## 产品信息
{productInfo}

## 用户需求
{userInstruction}

## 要求
1. 输出视频描述（用于 AI 视频生成，中英文均可，关键视觉元素尽量具体）
2. 描述要具体、生动，包含：产品外观、运动方式、镜头语言、背景环境、光影效果
3. 时长约 {duration} 秒
4. 风格：专业电商产品展示视频
5. 只输出 prompt 文本，不要其他内容`;

const ANALYZE_PROMPT = `分析这张产品图片，用 JSON 输出：
{
  "product": "产品名称（中文）",
  "color": "主色调（中文）",
  "material": "材质（中文）",
  "shape": "形状（中文）",
  "style": "风格（中文）",
  "features": "主要特征（中文，一句话）"
}
只输出 JSON。`;

/** 视频生成任务 */
export async function runVideoJob(jobId: string, productId: string | null, sourceMediaId: string, userInstruction: string, duration?: number): Promise<void> {
  const db = getDb();
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  emit("job.started" as EventType, { jobId });

  try {
    const srcMedia = db.select().from(media).where(eq(media.id, sourceMediaId)).all()[0];
    if (!srcMedia) throw new Error(`源图 ${sourceMediaId} 不存在`);
    const firstFrameB64 = await oss.getImageBase64(srcMedia.filePath);

    // ─── Step 1: VLM 分析产品图 ───
    emit("job.progress" as EventType, { jobId, progress: 10, message: "AI 分析产品图中..." });
    let productInfo = "";
    try {
      const analysisText = await Model.chat("vlm").ask({ prompt: ANALYZE_PROMPT, images: [firstFrameB64] }).run();
      const jsonStr = analysisText.replace(/```json\n?|\n?```/g, "").trim();
      const analysis = JSON.parse(jsonStr);
      productInfo = `产品：${analysis.product}，颜色：${analysis.color}，材质：${analysis.material}，形状：${analysis.shape}，风格：${analysis.style}，特征：${analysis.features}`;
      emit("job.progress" as EventType, { jobId, progress: 20, message: `产品分析完成: ${analysis.product}` });
    } catch (e) {
      // VLM 分析失败时降级使用用户指令
      productInfo = userInstruction;
      emit("job.progress" as EventType, { jobId, progress: 20, message: "产品分析降级，使用原始指令" });
    }

    // ─── Step 2: 生成专业视频 prompt ───
    emit("job.progress" as EventType, { jobId, progress: 25, message: "生成视频描述..." });
    const promptTemplate = VIDEO_PROMPT_TEMPLATE
      .replace("{productInfo}", productInfo)
      .replace("{userInstruction}", userInstruction)
      .replace("{duration}", String(duration || 5));

    let videoPrompt: string;
    try {
      videoPrompt = await Model.chat("orchestrator").ask({ prompt: promptTemplate }).run();
      videoPrompt = videoPrompt.replace(/^```[\w]*\n?|\n?```$/g, "").trim();
    } catch {
      videoPrompt = userInstruction;
    }

    emit("job.progress" as EventType, { jobId, progress: 30, message: `视频描述: ${videoPrompt.slice(0, 60)}...` });

    // ─── Step 3: 调用视频生成 API（带内容违规重试）───
    const resolved = resolveSlot("video");
    const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, resolved.vendorId)).all()[0];
    if (!credRow) throw new Error(`未配置 ${resolved.vendorId} 凭证`);
    const creds = decryptCredentials(credRow.valuesEnc);
    if (resolved.baseUrl) creds.baseUrl = resolved.baseUrl;

    emit("job.progress" as EventType, { jobId, progress: 40, message: `视频生成中（${resolved.vendorId}，约 1-3 分钟）...` });
    const adapter = getAdapter(resolved.adapter) as any;
    if (!adapter.generateVideo) throw new Error(`${resolved.adapter} 不支持视频生成`);

    // 内容违规时自动简化 prompt 重试（最多 3 次）
    const promptVariants = [
      videoPrompt,                    // 原始 Agent 生成的 prompt
      `${productInfo}。白底产品展示视频，平稳旋转，专业光线。`,  // 简化版
      `产品视频，展示${productInfo.split("，")[0] || "产品"}，干净背景，平稳运动。`, // 最简版
    ];
    let lastError: Error | null = null;
    let result: any = null;
    for (let attempt = 0; attempt < promptVariants.length; attempt++) {
      const currentPrompt = promptVariants[attempt];
      try {
        emit("job.progress" as EventType, { jobId, progress: 40, message: `视频生成中（尝试 ${attempt + 1}/3）...` });
        result = await adapter.generateVideo({
          prompt: currentPrompt,
          firstFrameBase64: firstFrameB64,
          duration: duration || 5,
          aspectRatio: "16:9",
          model: resolved.modelName,
        }, creds);
        videoPrompt = currentPrompt; // 成功则使用该 prompt
        break;
      } catch (e: any) {
        lastError = e;
        const isContentViolation = e?.message?.includes("content_policy") || e?.message?.includes("400");
        if (!isContentViolation || attempt === promptVariants.length - 1) throw e;
        emit("job.progress" as EventType, { jobId, progress: 40, message: `内容被拒绝，简化 prompt 重试...` });
      }
    }
    if (!result) throw lastError || new Error("视频生成失败");

    // ─── Step 4: 下载视频存 OSS ───
    emit("job.progress" as EventType, { jobId, progress: 90, message: "下载视频..." });
    const videoRes = await fetch(result.videoUrl);
    const buf = Buffer.from(await videoRes.arrayBuffer());
    const fileId = crypto.randomUUID();
    const filePath = `/${productId || "video"}/video/${fileId}.mp4`;
    await oss.writeFile(filePath, buf.toString("base64"));

    const mediaId = crypto.randomUUID();
    db.insert(media).values({
      id: mediaId, assetId: null, productId, jobId, type: "video", filePath, thumbPath: null,
      modelId: resolved.modelId, promptText: videoPrompt, params: JSON.stringify({ sourceMedia: sourceMediaId, duration, userInstruction }),
      genState: "done", errorReason: null, cost: result.cost, width: null, height: null, duration: duration || 5,
      slotCode: "VIDEO", sortOrder: 1, createdAt: Date.now(),
    }).run();

    emit("media.completed" as EventType, { jobId, mediaId });
    db.update(jobs).set({
      status: "done", progress: 100,
      result: JSON.stringify({ mediaIds: [mediaId], type: "video" }),
      finishedAt: Date.now(),
    }).where(eq(jobs.id, jobId)).run();
    emit("job.completed" as EventType, { jobId, resultMediaIds: [mediaId] });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    db.update(jobs).set({ status: "failed", error: errMsg, finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    emit("job.failed" as EventType, { jobId, error: errMsg });
  }
}
