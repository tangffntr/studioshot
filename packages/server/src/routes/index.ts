/**
 * server/routes/index.ts — Express 路由组装
 * 端点：POST /api/products, POST /api/jobs, GET /api/events(SSE), GET /api/media, /oss 静态
 */
import { Router } from "express";
import * as crypto from "node:crypto";
import { getDb, initSchema } from "../db/client";
import { products, media, jobs, templates, templateSlots, vendors, vendorCredentials, models, taskSlots, materials } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { eventBus } from "../agent/event-bus";
import { runJob } from "../agent/runner";
import { seedDefaults } from "../db/seed";
import { encryptCredentials, decryptCredentials } from "../model-manager/credentials";
import { listAdapters } from "../adapters/registry";
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
  const { productId, instruction, attachments, templateId, mode, referenceScene, product, skuProducts, person, topGarment, bottomGarment, duration } = parsed.data;
  const db = getDb();
  const jobId = crypto.randomUUID();
  const jobType = templateId ? "pipeline" : mode;
  db.insert(jobs).values({
    id: jobId, productId, type: jobType, instruction,
    payload: JSON.stringify({
      attachments: attachments || [], templateId: templateId || null,
      mode, referenceScene: referenceScene || null, product: product || null,
      skuProducts: skuProducts || null, person: person || null,
      topGarment: topGarment || null, bottomGarment: bottomGarment || null,
      duration: duration || null,
    }),
    status: "queued", progress: 0, result: null, error: null, createdAt: Date.now(), startedAt: null, finishedAt: null,
  }).run();
  // 异步执行（admit-then-run）
  runJob(jobId).catch((e) => console.error("[job] failed", e));
  res.json({ jobId });
});

/** POST /api/jobs/:id/continue — 续接对话（在原 job 上继续，不创建新 job） */
router.post("/api/jobs/:id/continue", async (req, res) => {
  const { instruction, attachments, useLastGenerated, templateId, mode } = req.body || {};
  if (!instruction) return res.status(400).json({ error: "需提供 instruction" });

  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, req.params.id)).all()[0];
  if (!job) return res.status(404).json({ error: "任务不存在" });
  if (job.status !== "done") return res.status(400).json({ error: "只能在已完成的任务上续接对话" });

  // 读取已有对话历史
  let conversationHistory: any[] = [];
  let lastMediaIds: string[] = [];
  if (job.result) {
    try {
      const result = JSON.parse(job.result);
      conversationHistory = result.conversationHistory || [];
      lastMediaIds = result.mediaIds || [];
    } catch {}
  }

  // 获取上次生成的最后一张图（用于 img2img 保一致性）
  const lastGeneratedMediaId = lastMediaIds.length > 0 ? lastMediaIds[lastMediaIds.length - 1] : null;

  // ⭐ 处理 attachments：如果没有新的 attachment 且 useLastGenerated 为 true，使用上次生成的图
  let finalAttachments = attachments || [];
  if (useLastGenerated && finalAttachments.length === 0 && lastGeneratedMediaId) {
    finalAttachments = [lastGeneratedMediaId];
    console.log(`[continue] 使用上次生成的产品图: ${lastGeneratedMediaId}`);
  }

  // ⭐ 更新 job 类型（如果有 templateId 则为 pipeline，否则为 agent）
  const jobType = templateId ? "pipeline" : (mode || "agent");

  // 更新原 job 状态为 queued，追加新指令到 payload
  const existingPayload = job.payload ? JSON.parse(job.payload) : {};
  db.update(jobs).set({
    status: "queued",
    type: jobType, // ⭐ 更新任务类型
    progress: 0,
    error: null,
    result: null, // 清空旧结果
    finishedAt: null,
    payload: JSON.stringify({
      ...existingPayload,
      templateId: templateId || existingPayload.templateId, // ⭐ 传递 templateId
      mode: mode || existingPayload.mode,
      attachments: [...(existingPayload.attachments || []), ...finalAttachments],
      previousMessages: conversationHistory, // ⭐ 传递对话历史
      lastGeneratedMediaId, // ⭐ 传递上次生成的图
      continuationInstruction: instruction, // ⭐ 续接的新指令
    }),
  }).where(eq(jobs.id, req.params.id)).run();

  // 异步执行原 job
  runJob(req.params.id).catch((e) => console.error("[job] continue failed", e));
  res.json({ jobId: req.params.id });
});

/** POST /api/jobs/:id/confirm — 确认/拒绝页面规划 */
router.post("/api/jobs/:id/confirm", async (req, res) => {
  const { type, status, feedback } = req.body || {};
  if (!type || !status) return res.status(400).json({ error: "需提供 type 和 status" });

  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, req.params.id)).all()[0];
  if (!job) return res.status(404).json({ error: "任务不存在" });

  // 更新job的payload，添加确认标记
  const payload = job.payload ? JSON.parse(job.payload) : {};

  if (type === "blueprint") {
    if (status === "approved") {
      payload.blueprintConfirmed = true;
      payload.blueprintRejected = false;
    } else if (status === "rejected") {
      payload.blueprintConfirmed = false;
      payload.blueprintRejected = true;
      payload.rejectionFeedback = feedback || "";
    }
  } else if (type === "visual_sample") {
    if (status === "approved") {
      payload.visualSampleConfirmed = true;
      payload.visualSampleRejected = false;
    } else if (status === "rejected") {
      payload.visualSampleConfirmed = false;
      payload.visualSampleRejected = true;
      payload.visualSampleFeedback = feedback || "";
    }
  }

  db.update(jobs).set({
    payload: JSON.stringify(payload),
  }).where(eq(jobs.id, req.params.id)).run();

  res.json({ ok: true });
});

/** GET /api/templates — 模板列表（含图位数） */
router.get("/api/templates", (_req, res) => {
  const db = getDb();
  const tpls = db.select().from(templates).all();
  const result = tpls.map((t) => {
    const slotCount = db.select().from(templateSlots).where(eq(templateSlots.templateId, t.id)).all().length;
    return { ...t, isBuiltin: !!t.isBuiltin, slotCount };
  });
  res.json(result);
});

/** GET /api/templates/:id — 模板详情（含全部图位） */
router.get("/api/templates/:id", (req, res) => {
  const db = getDb();
  const tpl = db.select().from(templates).where(eq(templates.id, req.params.id)).all()[0];
  if (!tpl) return res.status(404).json({ error: "模板不存在" });
  const slots = db.select().from(templateSlots).where(eq(templateSlots.templateId, req.params.id)).all().sort((a, b) => a.sequence - b.sequence);
  res.json({
    ...tpl,
    isBuiltin: !!tpl.isBuiltin,
    slots: slots.map((s) => ({ ...s, required: !!s.required })),
  });
});

/** POST /api/templates — 创建用户模板（含图位） */
router.post("/api/templates", (req, res) => {
  const db = getDb();
  const { name, category, platform, productCategory, description, slots } = req.body || {};
  if (!name || !category || !Array.isArray(slots)) return res.status(400).json({ error: "需提供 name, category, slots 数组" });
  const tplId = `user-${crypto.randomUUID()}`;
  const now = Date.now();
  db.insert(templates).values({
    id: tplId, name, category, platform: platform || null, productCategory: productCategory || null,
    description: description || null, isBuiltin: 0, version: 1, createdAt: now, updatedAt: now,
  }).run();
  for (const s of slots) {
    db.insert(templateSlots).values({
      id: `${tplId}-${s.slotCode}`, templateId: tplId, slotCode: s.slotCode, purpose: s.purpose,
      sequence: s.sequence, sceneType: s.sceneType || null, sizePreset: s.sizePreset || "1024x1024",
      taskSlotKey: s.taskSlotKey || "main-image", promptSkeleton: s.promptSkeleton || "",
      required: s.required === false ? 0 : 1, notes: s.notes || null,
    }).run();
  }
  res.json({ id: tplId });
});

/** PUT /api/templates/:id — 更新用户模板（含图位整体替换） */
router.put("/api/templates/:id", (req, res) => {
  const db = getDb();
  const tpl = db.select().from(templates).where(eq(templates.id, req.params.id)).all()[0];
  if (!tpl) return res.status(404).json({ error: "模板不存在" });
  if (tpl.isBuiltin) return res.status(403).json({ error: "内置模板不可修改" });
  const { name, description, slots } = req.body || {};
  db.update(templates).set({
    ...(name && { name }), ...(description != null && { description }), updatedAt: Date.now(),
  }).where(eq(templates.id, req.params.id)).run();
  // 图位整体替换（先删后插）
  if (Array.isArray(slots)) {
    db.delete(templateSlots).where(eq(templateSlots.templateId, req.params.id)).run();
    for (const s of slots) {
      db.insert(templateSlots).values({
        id: `${req.params.id}-${s.slotCode}-${crypto.randomUUID().slice(0, 8)}`, templateId: req.params.id,
        slotCode: s.slotCode, purpose: s.purpose, sequence: s.sequence, sceneType: s.sceneType || null,
        sizePreset: s.sizePreset || "1024x1024", taskSlotKey: s.taskSlotKey || "main-image",
        promptSkeleton: s.promptSkeleton || "", required: s.required === false ? 0 : 1, notes: s.notes || null,
      }).run();
    }
  }
  res.json({ ok: true });
});

/** DELETE /api/templates/:id — 删除用户模板（内置不可删） */
router.delete("/api/templates/:id", (req, res) => {
  const db = getDb();
  const tpl = db.select().from(templates).where(eq(templates.id, req.params.id)).all()[0];
  if (!tpl) return res.status(404).json({ error: "模板不存在" });
  if (tpl.isBuiltin) return res.status(403).json({ error: "内置模板不可删除" });
  db.delete(templateSlots).where(eq(templateSlots.templateId, req.params.id)).run();
  db.delete(templates).where(eq(templates.id, req.params.id)).run();
  res.json({ ok: true });
});

/** GET /api/settings — 模型配置（供应商 + 凭证值 + 模型 + 任务槽绑定） */
router.get("/api/settings", (_req, res) => {
  const db = getDb();
  const vs = db.select().from(vendors).all();
  const allModels = db.select().from(models).all();
  const slots = db.select().from(taskSlots).all();
  const result = vs.map((v) => {
    const cred = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, v.id)).all()[0];
    let credValues: Record<string, string> = {};
    let apiKey = "";
    let baseUrl = v.baseUrl || "";
    if (cred) {
      try { credValues = decryptCredentials(cred.valuesEnc); apiKey = credValues.apiKey || ""; if (credValues.baseUrl) baseUrl = credValues.baseUrl; } catch {}
    }
    const vendorModels = allModels.filter((m) => m.vendorId === v.id);
    return {
      id: v.id, name: v.name, category: v.category, adapter: v.adapter,
      apiKey, baseUrl,
      hasCredentials: !!cred && cred.enabled === 1 && !!apiKey,
      models: vendorModels.map((m) => ({ id: m.id, modelName: m.modelName, displayName: m.displayName, type: m.type, enabled: !!m.enabled, cellSize: m.cellSize || 1024 })),
    };
  });
  res.json({ vendors: result, taskSlots: slots, availableAdapters: listAdapters() });
});

/** PUT /api/settings/credentials — 更新供应商凭证（apiKey + baseUrl） */
router.put("/api/settings/credentials", (req, res) => {
  const { vendorId, apiKey, baseUrl } = req.body || {};
  if (!vendorId) return res.status(400).json({ error: "需提供 vendorId" });
  const db = getDb();
  // 合并已有值
  const existing = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, vendorId)).all()[0];
  let values: Record<string, string> = {};
  if (existing) { try { values = decryptCredentials(existing.valuesEnc); } catch {} }
  if (apiKey !== undefined) values.apiKey = apiKey;
  if (baseUrl !== undefined) values.baseUrl = baseUrl;
  const enc = encryptCredentials(values);
  if (existing) {
    db.update(vendorCredentials).set({ valuesEnc: enc, enabled: 1, updatedAt: Date.now() }).where(eq(vendorCredentials.vendorId, vendorId)).run();
  } else {
    db.insert(vendorCredentials).values({ vendorId, valuesEnc: enc, enabled: 1, updatedAt: Date.now() }).run();
  }
  // 同步 vendor.baseUrl
  if (values.baseUrl) db.update(vendors).set({ baseUrl: values.baseUrl }).where(eq(vendors.id, vendorId)).run();
  res.json({ ok: true });
});

/** PUT /api/settings/task-slot — 绑定模型到任务槽（支持备用模型） */
router.put("/api/settings/task-slot", (req, res) => {
  const { slotKey, modelId, backupModelId } = req.body || {};
  if (!slotKey) return res.status(400).json({ error: "需提供 slotKey" });
  const db = getDb();
  const backup = backupModelId === "" ? null : (backupModelId || undefined);
  const existing = db.select().from(taskSlots).where(eq(taskSlots.slotKey, slotKey)).all()[0];
  if (existing) {
    const update: Record<string, unknown> = {};
    if (modelId !== undefined) update.modelId = modelId;
    if (backup !== undefined) update.backupModelId = backup;
    if (Object.keys(update).length > 0) db.update(taskSlots).set(update).where(eq(taskSlots.slotKey, slotKey)).run();
  } else {
    db.insert(taskSlots).values({ slotKey, modelId: modelId || null, backupModelId: backup || null, params: null }).run();
  }
  res.json({ ok: true });
});

/** DELETE /api/jobs/:id — 删除历史任务（同步删该 job 的 media） */
router.delete("/api/jobs/:id", async (req, res) => {
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, req.params.id)).all()[0];
  if (!job) return res.status(404).json({ error: "not found" });
  // 删该 job 的 media 文件 + 记录
  const jobMedia = db.select().from(media).where(eq(media.jobId, req.params.id)).all();
  for (const m of jobMedia) { await oss.deleteFile(m.filePath).catch(() => {}); db.delete(media).where(eq(media.id, m.id)).run(); }
  db.delete(jobs).where(eq(jobs.id, req.params.id)).run();
  res.json({ ok: true });
});

/** PUT /api/settings/vendor/:id — 更新供应商（baseUrl + name） */
router.put("/api/settings/vendor/:id", (req, res) => {
  const db = getDb();
  const { baseUrl } = req.body || {};
  const v = db.select().from(vendors).where(eq(vendors.id, req.params.id)).all()[0];
  if (!v) return res.status(404).json({ error: "供应商不存在" });
  if (baseUrl !== undefined) {
    db.update(vendors).set({ baseUrl }).where(eq(vendors.id, req.params.id)).run();
  }
  res.json({ ok: true });
});

/** POST /api/settings/vendor — 创建自定义供应商 */
router.post("/api/settings/vendor", (req, res) => {
  const db = getDb();
  const { id, name, category, adapter, baseUrl } = req.body || {};
  if (!id || !name || !category || !adapter) return res.status(400).json({ error: "需提供 id, name, category, adapter" });
  if (!listAdapters().includes(adapter)) return res.status(400).json({ error: `未知适配器: ${adapter}，可用: ${listAdapters().join(", ")}` });
  const existing = db.select().from(vendors).where(eq(vendors.id, id)).all()[0];
  if (existing) return res.status(409).json({ error: "供应商 ID 已存在" });
  const passwordInput = [{ key: "apiKey", label: "API Key", type: "password", required: true }];
  db.insert(vendors).values({
    id, name, category, adapter, baseUrl: baseUrl || null,
    inputs: JSON.stringify(passwordInput), createdAt: Date.now(),
  }).run();
  res.json({ ok: true, id });
});

/** DELETE /api/settings/vendor/:id — 删除自定义供应商（级联清理） */
router.delete("/api/settings/vendor/:id", (req, res) => {
  const db = getDb();
  const v = db.select().from(vendors).where(eq(vendors.id, req.params.id)).all()[0];
  if (!v) return res.status(404).json({ error: "供应商不存在" });
  // 清理该供应商下所有模型
  const vendorModels = db.select().from(models).where(eq(models.vendorId, req.params.id)).all();
  for (const m of vendorModels) {
    // 清理引用这些模型的 task_slots
    const slots = db.select().from(taskSlots).all().filter((s) => s.modelId === m.id || s.backupModelId === m.id);
    for (const s of slots) {
      const update: Record<string, unknown> = {};
      if (s.modelId === m.id) update.modelId = null;
      if (s.backupModelId === m.id) update.backupModelId = null;
      db.update(taskSlots).set(update).where(eq(taskSlots.slotKey, s.slotKey)).run();
    }
    db.delete(models).where(eq(models.id, m.id)).run();
  }
  // 清理凭证
  db.delete(vendorCredentials).where(eq(vendorCredentials.vendorId, req.params.id)).run();
  // 删除供应商
  db.delete(vendors).where(eq(vendors.id, req.params.id)).run();
  res.json({ ok: true });
});

/** POST /api/settings/models — 添加自定义模型到供应商 */
router.post("/api/settings/models", (req, res) => {
  const db = getDb();
  const { vendorId, modelName, displayName, type, cellSize } = req.body || {};
  if (!vendorId || !modelName) return res.status(400).json({ error: "需提供 vendorId 和 modelName" });
  const modelId = `${vendorId}:${modelName}`;
  const existing = db.select().from(models).where(eq(models.id, modelId)).all()[0];
  if (existing) return res.status(409).json({ error: "模型已存在" });
  db.insert(models).values({
    id: modelId, vendorId, modelName, displayName: displayName || modelName,
    type: type || "image", modes: JSON.stringify(["text", "singleImage"]), pricing: null, enabled: 1,
    cellSize: cellSize || 1024,
  }).run();
  res.json({ id: modelId });
});

/** DELETE /api/settings/models/:id — 删除自定义模型 */
router.delete("/api/settings/models/:id", (req, res) => {
  const db = getDb();
  const m = db.select().from(models).where(eq(models.id, req.params.id)).all()[0];
  if (!m) return res.status(404).json({ error: "模型不存在" });
  db.delete(models).where(eq(models.id, req.params.id)).run();
  // 清除引用了该模型的 task_slot 绑定（主模型 + 备用模型）
  const slots = db.select().from(taskSlots).all().filter((s) => s.modelId === req.params.id || s.backupModelId === req.params.id);
  for (const s of slots) {
    const update: Record<string, unknown> = {};
    if (s.modelId === req.params.id) update.modelId = null;
    if (s.backupModelId === req.params.id) update.backupModelId = null;
    db.update(taskSlots).set(update).where(eq(taskSlots.slotKey, s.slotKey)).run();
  }
  res.json({ ok: true });
});

/** PUT /api/settings/models/:id/cell-size — 更新模型基础单元格尺寸（仅图像模型） */
router.put("/api/settings/models/:id/cell-size", (req, res) => {
  const db = getDb();
  const { cellSize } = req.body || {};
  if (!cellSize || ![512, 1024, 2048, 4096].includes(cellSize)) return res.status(400).json({ error: "cellSize 必须是 512/1024/2048/4096 之一" });
  const m = db.select().from(models).where(eq(models.id, req.params.id)).all()[0];
  if (!m) return res.status(404).json({ error: "模型不存在" });
  if (m.type !== "image") return res.status(400).json({ error: "仅图像模型支持配置 cellSize" });
  db.update(models).set({ cellSize }).where(eq(models.id, req.params.id)).run();
  res.json({ ok: true, cellSize });
});

/** GET /api/jobs — 任务列表（历史记录，按 createdAt 倒序，join 产品名） */
router.get("/api/jobs", (_req, res) => {
  const db = getDb();
  const allJobs = db.select().from(jobs).all().sort((a, b) => b.createdAt - a.createdAt);
  const allProducts = db.select().from(products).all();
  const productMap = new Map(allProducts.map((p) => [p.id, p.name]));
  res.json(allJobs.map((j) => ({
    id: j.id, productId: j.productId, productName: j.productId ? productMap.get(j.productId) || "未知" : null,
    type: j.type, instruction: j.instruction, status: j.status, progress: j.progress,
    result: j.result, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt,
  })));
});

/** GET /api/jobs/:id — 查任务状态 */
router.get("/api/jobs/:id", (req, res) => {
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, req.params.id)).all()[0];
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});

/** GET /api/media?productId=&jobId= — 媒体列表 */
router.get("/api/media", (req, res) => {
  const db = getDb();
  const pid = req.query.productId as string | undefined;
  const jid = req.query.jobId as string | undefined;
  let list;
  if (jid) list = db.select().from(media).where(eq(media.jobId, jid)).all();
  else if (pid) list = db.select().from(media).where(eq(media.productId, pid)).all();
  else list = db.select().from(media).all();
  list.sort((a, b) => {
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
    return a.createdAt - b.createdAt;
  });
  res.json(list.map((m) => ({ ...m, url: oss.getFileUrl(m.filePath) })));
});

/** GET /api/media/:id — 单图详情（含 prompt） */
router.get("/api/media/:id", (req, res) => {
  const db = getDb();
  const m = db.select().from(media).where(eq(media.id, req.params.id)).all()[0];
  if (!m) return res.status(404).json({ error: "not found" });
  res.json({ ...m, url: oss.getFileUrl(m.filePath) });
});

/** DELETE /api/media/:id — 删除媒体（同步删 OSS 文件） */
router.delete("/api/media/:id", async (req, res) => {
  const db = getDb();
  const m = db.select().from(media).where(eq(media.id, req.params.id)).all()[0];
  if (!m) return res.status(404).json({ error: "not found" });
  await oss.deleteFile(m.filePath);
  if (m.thumbPath) await oss.deleteFile(m.thumbPath).catch(() => {});
  db.delete(media).where(eq(media.id, req.params.id)).run();
  res.json({ ok: true });
});

/** PATCH /api/media/:id — 编辑 promptText */
router.patch("/api/media/:id", (req, res) => {
  const db = getDb();
  const { promptText } = req.body || {};
  if (promptText === undefined) return res.status(400).json({ error: "需提供 promptText" });
  const m = db.select().from(media).where(eq(media.id, req.params.id)).all()[0];
  if (!m) return res.status(404).json({ error: "not found" });
  db.update(media).set({ promptText }).where(eq(media.id, req.params.id)).run();
  res.json({ ok: true });
});

/** GET /api/materials — 素材库列表 */
router.get("/api/materials", (_req, res) => {
  const db = getDb();
  const list = db.select().from(materials).all().sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map((m) => ({ ...m, url: m.filePath ? oss.getFileUrl(m.filePath) : null })));
});

/** POST /api/materials — 从 media 转存 / 从 URL 创建 / 手动创建素材 */
router.post("/api/materials", async (req, res) => {
  const db = getDb();
  const { sourceMediaId, name, promptText, kind, category, platform, url } = req.body || {};
  if (!name) return res.status(400).json({ error: "需提供 name" });
  const mid = crypto.randomUUID();
  let filePath = "";
  let srcMediaId = sourceMediaId || null;

  if (sourceMediaId) {
    // 从 media 复制文件
    const src = db.select().from(media).where(eq(media.id, sourceMediaId)).all()[0];
    if (!src) return res.status(404).json({ error: "源 media 不存在" });
    const srcBuf = await oss.getFile(src.filePath);
    filePath = `/materials/${mid}.${(src.filePath.split(".").pop() || "png")}`;
    await oss.writeFile(filePath, srcBuf.toString("base64"));
    if (promptText === undefined) req.body.promptText = src.promptText;
  } else if (url) {
    // 从 URL 下载图片
    try {
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`下载失败 ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ext = url.includes(".png") ? "png" : "jpg";
      filePath = `/materials/${mid}.${ext}`;
      await oss.writeFile(filePath, buf.toString("base64"));
    } catch (e: any) {
      return res.status(400).json({ error: `下载图片失败: ${e.message}` });
    }
  } else {
    return res.status(400).json({ error: "需提供 sourceMediaId 或 url" });
  }

  db.insert(materials).values({
    id: mid, name, promptText: promptText || null, filePath,
    sourceMediaId: srcMediaId, kind: kind || "image",
    category: category || null, platform: platform || null,
    createdAt: Date.now(),
  }).run();
  res.json({ id: mid });
});

/** DELETE /api/materials/:id — 删除素材 */
router.delete("/api/materials/:id", async (req, res) => {
  const db = getDb();
  const m = db.select().from(materials).where(eq(materials.id, req.params.id)).all()[0];
  if (!m) return res.status(404).json({ error: "not found" });
  if (m.filePath) await oss.deleteFile(m.filePath).catch(() => {});
  db.delete(materials).where(eq(materials.id, req.params.id)).run();
  res.json({ ok: true });
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
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // ⭐ 禁用 nginx/代理缓冲，确保事件即时送达（修 blueprint 确认 UI 不显示）
  });
  res.flushHeaders(); // 立即发送响应头，避免 Vite 代理缓冲
  // 心跳（5s，更激进保活，防代理层超时断连）
  const heartbeat = setInterval(() => res.write(": hb\n\n"), 5000);
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
