/**
 * server/agent/scene-swap.ts — SKU 场景替换
 *
 * 输入：对标场景图（复用构图/光线/氛围）+ 自家产品图（替换进去）
 * 输出：同构图但产品替换为自家的图
 *
 * 用 grsai 图生图（多参考图），指令强调保持构图换产品。
 * 可行性报告 §六 SKU 场景替换。
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

const SWAP_PROMPT_PREFIX = "Replace the product in this scene with the provided product. Keep the exact same composition, camera angle, lighting direction, color temperature, and background atmosphere. Only swap the product subject. The new product should look natural in the existing scene.";

/** 场景替换任务 */
export async function runSceneSwapJob(jobId: string, productId: string | null, referenceSceneMediaId: string, productMediaId: string, instruction?: string): Promise<void> {
  const db = getDb();
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  emit("job.started" as EventType, { jobId });

  try {
    // 读两张参考图
    const sceneMedia = db.select().from(media).where(eq(media.id, referenceSceneMediaId)).all()[0];
    const prodMedia = db.select().from(media).where(eq(media.id, productMediaId)).all()[0];
    if (!sceneMedia) throw new Error(`对标场景图 ${referenceSceneMediaId} 不存在`);
    if (!prodMedia) throw new Error(`产品图 ${productMediaId} 不存在`);

    emit("job.progress" as EventType, { jobId, progress: 20, message: "读取参考图..." });
    const sceneB64 = await oss.getImageBase64(sceneMedia.filePath);
    const prodB64 = await oss.getImageBase64(prodMedia.filePath);

    // 指令：默认前缀 + 可选用户补充
    const prompt = instruction ? `${SWAP_PROMPT_PREFIX} ${instruction}` : SWAP_PROMPT_PREFIX;

    emit("job.progress" as EventType, { jobId, progress: 40, message: "生成场景替换图..." });
    emit("tool.call" as EventType, { jobId, toolName: "scene_swap", toolInput: { referenceScene: referenceSceneMediaId, product: productMediaId } });

    const fileId = crypto.randomUUID();
    const filePath = `/${productId || "swap"}/scene-swap/${fileId}.png`;
    const facade = Model.image("main-image").generate({
      prompt,
      referenceImages: [sceneB64, prodB64], // 两张参考：场景 + 产品
      size: "1024x1024",
    });
    await facade.run();
    const result = await facade.save(filePath, productId, prompt);

    // 标记为场景替换产出
    db.update(media).set({ slotCode: "SCENE-SWAP", sortOrder: 1 }).where(eq(media.id, result.mediaId)).run();

    emit("media.completed" as EventType, { jobId, mediaId: result.mediaId });
    emit("tool.result" as EventType, { jobId, toolName: "scene_swap", toolResult: { mediaId: result.mediaId } });

    db.update(jobs).set({
      status: "done", progress: 100,
      result: JSON.stringify({ mediaIds: [result.mediaId], type: "scene-swap" }),
      finishedAt: Date.now(),
    }).where(eq(jobs.id, jobId)).run();
    emit("job.completed" as EventType, { jobId, resultMediaIds: [result.mediaId] });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    db.update(jobs).set({ status: "failed", error: errMsg, finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    emit("job.failed" as EventType, { jobId, error: errMsg });
  }
}
