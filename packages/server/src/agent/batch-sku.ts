/**
 * server/agent/batch-sku.ts — SKU 套装批量生成
 *
 * 输入：母版场景图 + 多个 SKU 产品图（不同颜色/款式）
 * 输出：每个 SKU 一张场景替换图（同构图，不同产品）
 *
 * 本质：对每个 SKU 调一次场景替换。确定性循环，单张失败不中断。
 * 可行性报告 §六 SKU 套装批量。
 */
import * as crypto from "node:crypto";
import { getDb } from "../db/client";
import { media, jobs } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { Model } from "../model-manager/facade";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";

function emit(type: EventType, payload: Record<string, unknown>) {
  if (type === ("job.progress" as EventType) && payload.jobId && typeof payload.progress === "number") {
    getDb().update(jobs).set({ progress: payload.progress as number }).where(eq(jobs.id, payload.jobId as string)).run();
  }
  eventBus.publish({ type, ...payload } as SseEvent);
}

const SWAP_PROMPT = "Replace the product in this scene with the provided product. Keep the exact same composition, camera angle, lighting, and background. Only swap the product subject.";

/** SKU 批量任务 */
export async function runBatchSkuJob(jobId: string, productId: string | null, masterSceneMediaId: string, skuProductMediaIds: string[]): Promise<void> {
  const db = getDb();
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  emit("job.started" as EventType, { jobId });

  try {
    const sceneMedia = db.select().from(media).where(eq(media.id, masterSceneMediaId)).all()[0];
    if (!sceneMedia) throw new Error(`母版场景图 ${masterSceneMediaId} 不存在`);
    const sceneB64 = await oss.getImageBase64(sceneMedia.filePath);

    emit("job.progress" as EventType, { jobId, progress: 5, message: `开始批量生成 ${skuProductMediaIds.length} 个 SKU` });

    const mediaIds: string[] = [];
    for (let i = 0; i < skuProductMediaIds.length; i++) {
      const skuId = skuProductMediaIds[i];
      const pct = 5 + Math.round(((i + 1) / skuProductMediaIds.length) * 90);
      emit("job.progress" as EventType, { jobId, progress: pct, message: `SKU ${i + 1}/${skuProductMediaIds.length}` });
      emit("tool.call" as EventType, { jobId, toolName: "scene_swap", toolInput: { sku: skuId, index: i + 1 } });

      try {
        const prodMedia = db.select().from(media).where(eq(media.id, skuId)).all()[0];
        if (!prodMedia) { emit("tool.result" as EventType, { jobId, toolName: "scene_swap", toolResult: { error: `SKU ${skuId} 不存在` } }); continue; }
        const prodB64 = await oss.getImageBase64(prodMedia.filePath);

        const fileId = crypto.randomUUID();
        const filePath = `/${productId || "batch"}/sku-swap/sku${i + 1}_${fileId}.png`;
        const facade = Model.image("main-image").generate({ prompt: SWAP_PROMPT, referenceImages: [sceneB64, prodB64], size: "1024x1024" });
        await facade.run();
        const result = await facade.save(filePath, productId, SWAP_PROMPT);
        db.update(media).set({ slotCode: `SKU-${i + 1}`, sortOrder: i + 1 }).where(eq(media.id, result.mediaId)).run();

        mediaIds.push(result.mediaId);
        emit("media.completed" as EventType, { jobId, mediaId: result.mediaId });
        emit("tool.result" as EventType, { jobId, toolName: "scene_swap", toolResult: { sku: i + 1, mediaId: result.mediaId } });
      } catch (e: any) {
        emit("tool.result" as EventType, { jobId, toolName: "scene_swap", toolResult: { sku: i + 1, error: e?.message || String(e) } });
        // 单 SKU 失败不中断
      }
    }

    db.update(jobs).set({
      status: "done", progress: 100,
      result: JSON.stringify({ mediaIds, type: "batch-sku", total: skuProductMediaIds.length, generated: mediaIds.length }),
      finishedAt: Date.now(),
    }).where(eq(jobs.id, jobId)).run();
    emit("job.completed" as EventType, { jobId, resultMediaIds: mediaIds });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    db.update(jobs).set({ status: "failed", error: errMsg, finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    emit("job.failed" as EventType, { jobId, error: errMsg });
  }
}
