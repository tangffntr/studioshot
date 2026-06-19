/**
 * server/agent/runner.ts — 任务执行入口（admit-then-run 的 worker 侧）
 *
 * 分流：job.payload.templateId 有值 → runPipelineJob（模板套图）
 *       否则 → runAgentLoop（原单图 Agent 模式）
 */
import { getDb } from "../db/client";
import { jobs } from "../db/schema";
import { eq } from "drizzle-orm";
import { runAgentLoop } from "./loop";
import { runPipelineJob } from "./pipeline";
import { runSceneSwapJob } from "./scene-swap";
import { runBatchSkuJob } from "./batch-sku";
import { eventBus } from "./event-bus";

/** 执行一个 job（从 jobId） */
export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
  if (!job) throw new Error(`job ${jobId} 不存在`);

  const payload = job.payload ? JSON.parse(job.payload) : {};
  const templateId: string | null = payload.templateId || null;
  const jobMode: string = payload.mode || "";

  // 分流：batch-sku 模式（批量场景替换）
  if (jobMode === "batch-sku") {
    const refScene = payload.referenceScene;
    const skuProducts: string[] = payload.skuProducts || [];
    if (!refScene || skuProducts.length === 0) {
      db.update(jobs).set({ status: "failed", error: "batch-sku 需提供 referenceScene 和 skuProducts 数组", finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
      eventBus.publish({ type: "job.failed", jobId, error: "缺少 referenceScene 或 skuProducts" });
      return;
    }
    await runBatchSkuJob(jobId, job.productId, refScene, skuProducts);
    return;
  }

  // 分流：scene-swap 模式（保构图换产品）
  if (jobMode === "scene-swap") {
    const refScene = payload.referenceScene;
    const product = payload.product || (payload.attachments || [])[0];
    if (!refScene || !product) {
      db.update(jobs).set({ status: "failed", error: "scene-swap 需提供 referenceScene 和 product mediaId", finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
      eventBus.publish({ type: "job.failed", jobId, error: "缺少 referenceScene 或 product" });
      return;
    }
    await runSceneSwapJob(jobId, job.productId, refScene, product, payload.instruction);
    return;
  }

  // 分流：有 templateId 走 Pipeline（pipeline 自己管 job 状态）
  if (templateId) {
    const attachments: string[] = payload.attachments || [];
    const sourceMediaId = attachments[0];
    if (!sourceMediaId) {
      db.update(jobs).set({ status: "failed", error: "pipeline 任务需提供 source mediaId（attachments[0]）", finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
      eventBus.publish({ type: "job.failed", jobId, error: "缺少 source mediaId" });
      return;
    }
    await runPipelineJob(jobId, templateId, job.productId || "", sourceMediaId);
    return;
  }

  // 原 Agent 模式（单图）
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  try {
    const initialMediaIds: string[] = payload.attachments || [];
    const result = await runAgentLoop({
      jobId,
      productId: job.productId,
      instruction: job.instruction,
      initialMediaIds,
    });
    db.update(jobs).set({
      status: "done", progress: 100,
      result: JSON.stringify({ mediaIds: result.mediaIds, text: result.finalText }),
      finishedAt: Date.now(),
    }).where(eq(jobs.id, jobId)).run();
    eventBus.publish({ type: "job.completed", jobId, resultMediaIds: result.mediaIds });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    db.update(jobs).set({ status: "failed", error: errMsg, finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    eventBus.publish({ type: "job.failed", jobId, error: errMsg });
  }
}

/** worker 模式：轮询 queued 任务并执行（可选，MVP 用直接调用） */
export async function startWorker(intervalMs = 2000): Promise<void> {
  const db = getDb();
  setInterval(() => {
    const queued = db.select().from(jobs).where(eq(jobs.status, "queued")).all()[0];
    if (queued) {
      runJob(queued.id).catch((e) => console.error("[worker] job failed", e));
    }
  }, intervalMs);
}
