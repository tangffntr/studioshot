/**
 * server/model-manager/facade.ts — 统一门面（照搬 Toonflow ai.ts 链式风格）
 *
 * 用法：
 *   const m = await Model.image("main-image")
 *     .generate({ prompt, referenceImages, size })
 *     .save(`/${productId}/main/${uuid}.png`);
 *   // m.base64 可回灌主 LLM，m.mediaId 入库
 *
 *   const text = await Model.chat("orchestrator").ask({ prompt, images });
 *
 * 内部：task_slots 解析模型 → 取凭证解密 → 调 adapter → 落 OSS + 建 media + 记 api_calls
 * 支持备用模型：主模型失败时自动 fallback 到备用模型
 */
import { resolveSlotWithBackup, type ResolvedModel } from "./task-slots";
import { getAdapter } from "../adapters/registry";
import { decryptCredentials } from "./credentials";
import { getDb } from "../db/client";
import { media, apiCalls, vendorCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import * as crypto from "node:crypto";

/** 获取适配器凭证（解密后） */
function getCreds(vendorId: string, baseUrl?: string | null): Record<string, string> {
  const db = getDb();
  const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, vendorId)).all()[0];
  if (!credRow) throw new Error(`供应商 ${vendorId} 未配置凭证`);
  const creds = decryptCredentials(credRow.valuesEnc);
  if (baseUrl) creds.baseUrl = baseUrl;
  return creds;
}

/** 生成结果（含 mediaId + base64，供工具回灌主 LLM） */
export interface ImageGenResult {
  mediaId: string;
  filePath: string;
  base64: string;
  mime: string;
  cost: number;
}

class ImageFacade {
  private slotKey: string;
  private prompt = "";
  private referenceImages: string[] = [];
  private size = "1024x1024";
  private gridSize?: "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2" | "3x3";
  private result: ImageGenResult | null = null;

  constructor(slotKey: string) {
    this.slotKey = slotKey;
  }

  generate(opts: { prompt: string; referenceImages?: string[]; size?: string; gridSize?: "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2" | "3x3" }): this {
    this.prompt = opts.prompt;
    this.referenceImages = opts.referenceImages || [];
    this.size = opts.size || "1024x1024";
    this.gridSize = opts.gridSize;
    return this;
  }

  async run(): Promise<this> {
    const { primary, backup } = resolveSlotWithBackup(this.slotKey);
    const db = getDb();

    // 尝试主模型，失败则 fallback 到备用模型
    const attempts: { resolved: ResolvedModel; role: "primary" | "backup" }[] = [{ resolved: primary, role: "primary" }];
    if (backup) attempts.push({ resolved: backup, role: "backup" });

    let lastError: unknown;
    for (const attempt of attempts) {
      const { resolved, role } = attempt;
      const adapter = getAdapter(resolved.adapter);
      if (!adapter.generateImage) { lastError = new Error(`${resolved.vendorId} 不支持 generateImage`); continue; }

      const creds = getCreds(resolved.vendorId, resolved.baseUrl);
      const start = Date.now();
      try {
        const res = await adapter.generateImage(
          { model: resolved.modelName, prompt: this.prompt, referenceImages: this.referenceImages, size: this.size, gridSize: this.gridSize },
          creds
        );
        const durationMs = Date.now() - start;

        // 记 api_calls（审计 + 计费，标注 primary/backup）
        db.insert(apiCalls).values({
          id: crypto.randomUUID(), jobId: null, modelId: resolved.modelId, vendorId: resolved.vendorId,
          requestSummary: `[${role}] ${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
          durationMs, cost: res.cost, status: "success", error: null, createdAt: Date.now(),
        }).run();

        this.result = { mediaId: "", filePath: "", base64: res.base64, mime: res.mime, cost: res.cost };
        return this;
      } catch (e: any) {
        lastError = e;
        // 记失败的 api_calls
        db.insert(apiCalls).values({
          id: crypto.randomUUID(), jobId: null, modelId: resolved.modelId, vendorId: resolved.vendorId,
          requestSummary: `[${role}] ${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
          durationMs: Date.now() - start, cost: 0, status: "failed", error: e?.message || String(e), createdAt: Date.now(),
        }).run();
        if (role === "backup" || !backup) throw e; // 备用也失败或无备用，直接抛错
        console.log(`[facade] ${this.slotKey} 主模型失败，切换备用模型 ${backup.modelId}: ${e?.message?.slice(0, 80)}`);
      }
    }
    throw lastError;
  }

  async save(filePath: string, productId: string | null = null, promptText: string | null = null, jobId?: string): Promise<ImageGenResult> {
    if (!this.result) throw new Error("未先调用 run()");
    const relPath = await oss.writeFile(filePath, this.result.base64);
    const mediaId = crypto.randomUUID();
    const db = getDb();
    db.insert(media).values({
      id: mediaId,
      assetId: null,
      productId,
      jobId: jobId || null,
      type: "image",
      filePath: relPath,
      thumbPath: null,
      modelId: null,
      promptText: promptText || this.prompt,
      params: JSON.stringify({ size: this.size, refCount: this.referenceImages.length }),
      genState: "done",
      errorReason: null,
      cost: this.result.cost,
      width: null,
      height: null,
      duration: null,
      createdAt: Date.now(),
    }).run();
    this.result.mediaId = mediaId;
    this.result.filePath = relPath;
    return this.result;
  }
}

class ChatFacade {
  private slotKey: string;
  private prompt = "";
  private images: string[] = [];

  constructor(slotKey: string) {
    this.slotKey = slotKey;
  }

  ask(opts: { prompt: string; images?: string[] }): this {
    this.prompt = opts.prompt;
    this.images = opts.images || [];
    return this;
  }

  async run(): Promise<string> {
    const { primary, backup } = resolveSlotWithBackup(this.slotKey);
    const db = getDb();

    // 尝试主模型，失败则 fallback 到备用模型
    const attempts: { resolved: ResolvedModel; role: "primary" | "backup" }[] = [{ resolved: primary, role: "primary" }];
    if (backup) attempts.push({ resolved: backup, role: "backup" });

    let lastError: unknown;
    for (const attempt of attempts) {
      const { resolved, role } = attempt;
      const adapter = getAdapter(resolved.adapter);
      if (!adapter.chat) { lastError = new Error(`${resolved.vendorId} 不支持 chat`); continue; }

      const creds = getCreds(resolved.vendorId, resolved.baseUrl);
      const start = Date.now();
      try {
        const text = await adapter.chat({ model: resolved.modelName, prompt: this.prompt, images: this.images }, creds);
        db.insert(apiCalls).values({
          id: crypto.randomUUID(), jobId: null, modelId: resolved.modelId, vendorId: resolved.vendorId,
          requestSummary: `[${role}] ${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
          durationMs: Date.now() - start, cost: 0, status: "success", error: null, createdAt: Date.now(),
        }).run();
        return text;
      } catch (e: any) {
        lastError = e;
        db.insert(apiCalls).values({
          id: crypto.randomUUID(), jobId: null, modelId: resolved.modelId, vendorId: resolved.vendorId,
          requestSummary: `[${role}] ${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
          durationMs: Date.now() - start, cost: 0, status: "failed", error: e?.message || String(e), createdAt: Date.now(),
        }).run();
        if (role === "backup" || !backup) throw e;
        console.log(`[facade] ${this.slotKey} 主模型失败，切换备用模型 ${backup.modelId}: ${e?.message?.slice(0, 80)}`);
      }
    }
    throw lastError;
  }
}

export const Model = {
  image: (slotKey: string) => new ImageFacade(slotKey),
  chat: (slotKey: string) => new ChatFacade(slotKey),
};
