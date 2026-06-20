/**
 * server/agent/video.ts — 视频生成任务
 *
 * 输入：主图（首帧）+ prompt
 * 输出：商品视频（可灵图生视频）
 */
import * as crypto from "node:crypto";
import { getDb } from "../db/client";
import { media, jobs, vendors, vendorCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { getAdapter } from "../adapters/registry";
import { decryptCredentials } from "../model-manager/credentials";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";

function emit(type: EventType, payload: Record<string, unknown>) {
  if (type === ("job.progress" as EventType) && payload.jobId && typeof payload.progress === "number") {
    getDb().update(jobs).set({ progress: payload.progress as number }).where(eq(jobs.id, payload.jobId as string)).run();
  }
  eventBus.publish({ type, ...payload } as SseEvent);
}

/** 视频生成任务 */
export async function runVideoJob(jobId: string, productId: string | null, sourceMediaId: string, prompt: string, duration?: number): Promise<void> {
  const db = getDb();
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  emit("job.started" as EventType, { jobId });

  try {
    const srcMedia = db.select().from(media).where(eq(media.id, sourceMediaId)).all()[0];
    if (!srcMedia) throw new Error(`源图 ${sourceMediaId} 不存在`);
    const firstFrameB64 = await oss.getImageBase64(srcMedia.filePath);

    emit("job.progress" as EventType, { jobId, progress: 20, message: "调用可灵图生视频..." });

    const vendor = db.select().from(vendors).where(eq(vendors.id, "kling-video")).all()[0];
    if (!vendor) throw new Error("未配置 kling-video 供应商");
    const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, "kling-video")).all()[0];
    if (!credRow) throw new Error("未配置可灵视频凭证");
    const creds = decryptCredentials(credRow.valuesEnc);

    emit("job.progress" as EventType, { jobId, progress: 40, message: "视频生成中（约 1-3 分钟）..." });
    const adapter = getAdapter("kling-video") as any;
    const result = await adapter.generateVideo({ prompt, firstFrameBase64: firstFrameB64, duration, aspectRatio: "16:9" }, creds);

    // 下载视频存 OSS
    emit("job.progress" as EventType, { jobId, progress: 90, message: "下载视频..." });
    const videoRes = await fetch(result.videoUrl);
    const buf = Buffer.from(await videoRes.arrayBuffer());
    const fileId = crypto.randomUUID();
    const filePath = `/${productId || "video"}/video/${fileId}.mp4`;
    await oss.writeFile(filePath, buf.toString("base64"));

    const mediaId = crypto.randomUUID();
    db.insert(media).values({
      id: mediaId, assetId: null, productId, jobId, type: "video", filePath, thumbPath: null,
      modelId: null, promptText: prompt, params: JSON.stringify({ sourceMedia: sourceMediaId, duration }),
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
