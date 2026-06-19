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
 */
import { resolveSlot } from "./task-slots";
import { getAdapter } from "../adapters/registry";
import { decryptCredentials } from "./credentials";
import { getDb } from "../db/client";
import { media, apiCalls, vendorCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import * as crypto from "node:crypto";

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
  private result: ImageGenResult | null = null;

  constructor(slotKey: string) {
    this.slotKey = slotKey;
  }

  generate(opts: { prompt: string; referenceImages?: string[]; size?: string }): this {
    this.prompt = opts.prompt;
    this.referenceImages = opts.referenceImages || [];
    this.size = opts.size || "1024x1024";
    return this;
  }

  async run(): Promise<this> {
    const resolved = resolveSlot(this.slotKey);
    const adapter = getAdapter(resolved.adapter);
    if (!adapter.generateImage) throw new Error(`${resolved.vendorId} 不支持 generateImage`);

    // 取凭证
    const db = getDb();
    const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, resolved.vendorId)).all()[0];
    if (!credRow) throw new Error(`供应商 ${resolved.vendorId} 未配置凭证`);
    const creds = decryptCredentials(credRow.valuesEnc);
    if (resolved.baseUrl) creds.baseUrl = resolved.baseUrl;

    const start = Date.now();
    const res = await adapter.generateImage(
      { model: resolved.modelName, prompt: this.prompt, referenceImages: this.referenceImages, size: this.size },
      creds
    );
    const durationMs = Date.now() - start;

    // 记 api_calls（审计 + 计费）
    const callId = crypto.randomUUID();
    db.insert(apiCalls).values({
      id: callId,
      jobId: null,
      modelId: resolved.modelId,
      vendorId: resolved.vendorId,
      requestSummary: `${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
      durationMs,
      cost: res.cost,
      status: "success",
      error: null,
      createdAt: Date.now(),
    }).run();

    this.result = {
      mediaId: "", // save() 时填
      filePath: "",
      base64: res.base64,
      mime: res.mime,
      cost: res.cost,
    };
    return this;
  }

  async save(filePath: string, productId: string | null = null, promptText: string | null = null): Promise<ImageGenResult> {
    if (!this.result) throw new Error("未先调用 run()");
    const relPath = await oss.writeFile(filePath, this.result.base64);
    const mediaId = crypto.randomUUID();
    const db = getDb();
    db.insert(media).values({
      id: mediaId,
      assetId: null,
      productId,
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
    const resolved = resolveSlot(this.slotKey);
    const adapter = getAdapter(resolved.adapter);
    if (!adapter.chat) throw new Error(`${resolved.vendorId} 不支持 chat`);

    const db = getDb();
    const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, resolved.vendorId)).all()[0];
    if (!credRow) throw new Error(`供应商 ${resolved.vendorId} 未配置凭证`);
    const creds = decryptCredentials(credRow.valuesEnc);
    if (resolved.baseUrl) creds.baseUrl = resolved.baseUrl;

    const start = Date.now();
    try {
      const text = await adapter.chat({ model: resolved.modelName, prompt: this.prompt, images: this.images }, creds);
      db.insert(apiCalls).values({
        id: crypto.randomUUID(), jobId: null, modelId: resolved.modelId, vendorId: resolved.vendorId,
        requestSummary: `${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
        durationMs: Date.now() - start, cost: 0, status: "success", error: null, createdAt: Date.now(),
      }).run();
      return text;
    } catch (e: any) {
      db.insert(apiCalls).values({
        id: crypto.randomUUID(), jobId: null, modelId: resolved.modelId, vendorId: resolved.vendorId,
        requestSummary: `${resolved.modelName}: ${this.prompt.slice(0, 80)}`,
        durationMs: Date.now() - start, cost: 0, status: "failed", error: e?.message || String(e), createdAt: Date.now(),
      }).run();
      throw e;
    }
  }
}

export const Model = {
  image: (slotKey: string) => new ImageFacade(slotKey),
  chat: (slotKey: string) => new ChatFacade(slotKey),
};
