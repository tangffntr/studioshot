/**
 * server/routes/index.ts — Express 路由组装
 * 端点：POST /api/products, POST /api/jobs, GET /api/events(SSE), GET /api/media, /oss 静态
 */
import { Router } from "express";
import * as crypto from "node:crypto";
import { getDb, initSchema } from "../db/client";
import { products, media, jobs } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { eventBus } from "../agent/event-bus";
import { runJob } from "../agent/runner";
import { seedDefaults } from "../db/seed";
import { CreateProductRequest, CreateJobRequest } from "@ecom/shared";
import type { SseEvent } from "@ecom/shared";
import path from "node:path";

const router = Router();

// 启动时初始化
initSchema();
seedDefaults();

/** POST /api/products — 上传产品图，建 product + media */
router.post("/api/products", async (req, res) => {
  const parsed = CreateProductRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { name, imageBase64, imageMime, category } = parsed.data;
  const db = getDb();
  const productId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const filePath = `/${productId}/source/${mediaId}.${(imageMime.split("/")[1] || "png").replace("jpeg", "jpg")}`;
  await oss.writeFile(filePath, imageBase64);
  db.insert(products).values({
    id: productId, name, category: category || null, attributes: null, sellingPoints: null, brandKitId: null, createdAt: Date.now(),
  }).run();
  db.insert(media).values({
    id: mediaId, assetId: null, productId, type: "image", filePath, thumbPath: null,
    modelId: null, promptText: null, params: null, genState: "done", errorReason: null,
    cost: null, width: null, height: null, duration: null, createdAt: Date.now(),
  }).run();
  res.json({ productId, mediaId });
});

/** POST /api/jobs — admit-then-run：插 job → 立即返回 jobId → 异步 runJob */
router.post("/api/jobs", async (req, res) => {
  const parsed = CreateJobRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { productId, instruction, attachments, mode } = parsed.data;
  const db = getDb();
  const jobId = crypto.randomUUID();
  db.insert(jobs).values({
    id: jobId, productId, type: mode, instruction, payload: JSON.stringify({ attachments: attachments || [] }),
    status: "queued", progress: 0, result: null, error: null, createdAt: Date.now(), startedAt: null, finishedAt: null,
  }).run();
  // 异步执行（admit-then-run）
  runJob(jobId).catch((e) => console.error("[job] failed", e));
  res.json({ jobId });
});

/** GET /api/jobs/:id — 查任务状态 */
router.get("/api/jobs/:id", (req, res) => {
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, req.params.id)).all()[0];
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

/** GET /api/media?productId= — 媒体列表 */
router.get("/api/media", (req, res) => {
  const db = getDb();
  const pid = req.query.productId as string | undefined;
  const list = pid
    ? db.select().from(media).where(eq(media.productId, pid)).all()
    : db.select().from(media).all();
  res.json(list.map((m) => ({ ...m, url: oss.getFileUrl(m.filePath) })));
});

/** GET /api/products — 产品列表 */
router.get("/api/products", (_req, res) => {
  const db = getDb();
  res.json(db.select().from(products).all());
});

/** GET /api/events — SSE 流（所有进度，按 jobId 透传，前端自行过滤） */
router.get("/api/events", (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // 心跳
  const heartbeat = setInterval(() => res.write(": hb\n\n"), 15000);
  const unsub = eventBus.subscribe((event: SseEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  _req.on("close", () => {
    clearInterval(heartbeat);
    unsub();
  });
});

// /oss 静态服务（生成图访问）
import express from "express";
const ossRoot = path.resolve(process.cwd(), "data/oss");
router.use("/oss", express.static(ossRoot));

export default router;
