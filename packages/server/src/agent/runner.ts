/**
 * server/agent/runner.ts — 任务执行入口（admit-then-run 的 worker 侧）
 *
 * 流程：jobs 表取 queued 任务 → runAgentLoop → 更新 jobs 状态 + result
 * routes/jobs 提交任务后异步调 runJob；worker 模式可轮询。
 */
import { getDb } from "../db/client";
import { jobs } from "../db/schema";
import { eq } from "drizzle-orm";
import { runAgentLoop } from "./loop";
import { eventBus } from "./event-bus";

/** 执行一个 job（从 jobId） */
export async function runJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
  if (!job) throw new Error(`job ${jobId} 不存在`);

  // 标记 running
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();

  try {
    const initialMediaIds: string[] = job.payload ? JSON.parse(job.payload).attachments || [] : [];
    const result = await runAgentLoop({
      jobId,
      productId: job.productId,
      instruction: job.instruction,
      initialMediaIds,
    });

    // 完成
    db.update(jobs)
      .set({
        status: "done",
        progress: 100,
        result: JSON.stringify({ mediaIds: result.mediaIds, text: result.finalText }),
        finishedAt: Date.now(),
      })
      .where(eq(jobs.id, jobId))
      .run();
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
