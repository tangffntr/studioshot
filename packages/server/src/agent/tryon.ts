/**
 * server/agent/tryon.ts — 虚拟试穿任务
 *
 * 输入：模特图 + 服装平铺图（上装/下装）
 * 输出：试穿效果图（OutfitAnyone）
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

/** 试穿任务 */
export async function runTryonJob(jobId: string, productId: string | null, personMediaId: string, topGarmentMediaId?: string, bottomGarmentMediaId?: string): Promise<void> {
  const db = getDb();
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  emit("job.started" as EventType, { jobId });

  try {
    const personMedia = db.select().from(media).where(eq(media.id, personMediaId)).all()[0];
    if (!personMedia) throw new Error(`模特图 ${personMediaId} 不存在`);
    const personB64 = await oss.getImageBase64(personMedia.filePath);

    let topB64: string | undefined;
    let bottomB64: string | undefined;
    if (topGarmentMediaId) {
      const m = db.select().from(media).where(eq(media.id, topGarmentMediaId)).all()[0];
      if (m) topB64 = await oss.getImageBase64(m.filePath);
    }
    if (bottomGarmentMediaId) {
      const m = db.select().from(media).where(eq(media.id, bottomGarmentMediaId)).all()[0];
      if (m) bottomB64 = await oss.getImageBase64(m.filePath);
    }

    emit("job.progress" as EventType, { jobId, progress: 30, message: "调用 OutfitAnyone 试穿..." });

    // 取凭证 + 调适配器
    const vendor = db.select().from(vendors).where(eq(vendors.id, "aliyun-tryon")).all()[0];
    if (!vendor) throw new Error("未配置 aliyun-tryon 供应商");
    const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, "aliyun-tryon")).all()[0];
    if (!credRow) throw new Error("未配置阿里云试穿凭证");
    const creds = decryptCredentials(credRow.valuesEnc);

    const adapter = getAdapter("aliyun-tryon") as any;
    const result = await adapter.tryon({ personImageBase64: personB64, topGarmentBase64: topB64, bottomGarmentBase64: bottomB64 }, creds);

    // 保存
    const fileId = crypto.randomUUID();
    const filePath = `/${productId || "tryon"}/tryon/${fileId}.png`;
    await oss.writeFile(filePath, result.base64);
    const mediaId = crypto.randomUUID();
    db.insert(media).values({
      id: mediaId, assetId: null, productId, jobId, type: "image", filePath, thumbPath: null,
      modelId: null, promptText: "OutfitAnyone 试穿", params: JSON.stringify({ person: personMediaId, top: topGarmentMediaId, bottom: bottomGarmentMediaId }),
      genState: "done", errorReason: null, cost: result.cost, width: null, height: null, duration: null,
      slotCode: "TRYON", sortOrder: 1, createdAt: Date.now(),
    }).run();

    emit("media.completed" as EventType, { jobId, mediaId });
    db.update(jobs).set({
      status: "done", progress: 100,
      result: JSON.stringify({ mediaIds: [mediaId], type: "tryon" }),
      finishedAt: Date.now(),
    }).where(eq(jobs.id, jobId)).run();
    emit("job.completed" as EventType, { jobId, resultMediaIds: [mediaId] });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    db.update(jobs).set({ status: "failed", error: errMsg, finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    emit("job.failed" as EventType, { jobId, error: errMsg });
  }
}
