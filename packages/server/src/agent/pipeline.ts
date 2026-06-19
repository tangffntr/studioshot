/**
 * server/agent/pipeline.ts — Pipeline Runner（模板套图确定性驱动）
 *
 * 流程：
 *   1. analyze_product 获取产品属性（复用 Model.chat + VLM）
 *   2. renderAllSlots 渲染全部图位 prompt
 *   3. for slot in slots（确定性遍历）：
 *        Model.image(slot.taskSlotKey).generate({prompt, referenceImages, size}).run().save()
 *        media 记录 slotCode + sortOrder
 *        emit SSE 进度
 *   4. 汇总 mediaIds，job done
 *
 * 与 runAgentLoop 的关系：runner 根据 job.payload.templateId 分流——
 *   有 templateId → runPipelineJob；无 → runAgentLoop（原单图模式）
 */
import * as crypto from "node:crypto";
import { getDb } from "../db/client";
import { templates, templateSlots, media, jobs } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { Model } from "../model-manager/facade";
import { renderAllSlots, type ProductAttributes, type RenderedSlot } from "../template/render";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";

const ANALYZE_PROMPT = `你是一个电商产品分析专家。请分析这张产品图，输出严格的 JSON：
{
  "category": "产品类目英文（如 mug/bottle/shirt/phone）",
  "attributes": { "color": "主色英文", "material": "材质英文", "shape": "形状英文", "style": "风格英文" }
}
只输出 JSON，不要其他文字。`;

function emit(type: EventType, payload: Record<string, unknown>) {
  // progress 类型同步更新 job 表（前端轮询 job 状态用）
  if (type === ("job.progress" as EventType) && payload.jobId && typeof payload.progress === "number") {
    getDb().update(jobs).set({ progress: payload.progress as number }).where(eq(jobs.id, payload.jobId as string)).run();
  }
  eventBus.publish({ type, ...payload } as SseEvent);
}

/** VLM 分析产品图，返回渲染器所需的属性 */
async function analyzeForRender(sourceMediaId: string): Promise<ProductAttributes> {
  const db = getDb();
  const m = db.select().from(media).where(eq(media.id, sourceMediaId)).all()[0];
  if (!m) throw new Error(`源 media ${sourceMediaId} 不存在`);
  const imgB64 = await oss.getImageBase64(m.filePath);

  const text = await Model.chat("vlm").ask({ prompt: ANALYZE_PROMPT, images: [imgB64] }).run();
  const jsonStr = text.replace(/```json\n?|\n?```/g, "").trim();
  try {
    const parsed = JSON.parse(jsonStr);
    // 合并 category + attributes 为扁平结构（渲染器需要）
    return {
      category: parsed.category,
      color: parsed.attributes?.color,
      material: parsed.attributes?.material,
      shape: parsed.attributes?.shape,
      style: parsed.attributes?.style,
      ...parsed.attributes,
    };
  } catch {
    return { category: "product", color: "neutral", material: "premium" };
  }
}

/** Pipeline 任务执行入口 */
export async function runPipelineJob(jobId: string, templateId: string, productId: string, sourceMediaId: string): Promise<void> {
  const db = getDb();

  // 标记 running
  db.update(jobs).set({ status: "running", startedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
  emit("job.started" as EventType, { jobId });

  try {
    // 1. 加载模板 + 图位
    const tpl = db.select().from(templates).where(eq(templates.id, templateId)).all()[0];
    if (!tpl) throw new Error(`模板 ${templateId} 不存在`);
    const slots = db.select().from(templateSlots).where(eq(templateSlots.templateId, templateId)).all().sort((a, b) => a.sequence - b.sequence);
    if (slots.length === 0) throw new Error(`模板 ${templateId} 无图位`);

    emit("job.progress" as EventType, { jobId, progress: 5, message: `加载模板「${tpl.name}」（${slots.length} 图位）` });

    // 2. 分析产品属性
    emit("job.progress" as EventType, { jobId, progress: 10, message: "分析产品属性..." });
    console.log(`[pipeline] job=${jobId.slice(0,8)} 分析产品...`);
    const attrs = await analyzeForRender(sourceMediaId);
    console.log(`[pipeline] job=${jobId.slice(0,8)} 分析完成:`, JSON.stringify(attrs));
    emit("agent.message" as EventType, { jobId, text: `产品分析：${attrs.category || "product"}，颜色 ${attrs.color || "neutral"}，材质 ${attrs.material || "premium"}` });

    // 3. 渲染全部图位 prompt
    const rendered: RenderedSlot[] = renderAllSlots(slots as any, attrs);

    // 4. 读源图 base64（图生图参考，保证产品保真）
    const srcMedia = db.select().from(media).where(eq(media.id, sourceMediaId)).all()[0];
    const srcB64 = srcMedia ? await oss.getImageBase64(srcMedia.filePath) : "";

    // 5. 确定性遍历图位，逐个生图
    const mediaIds: string[] = [];
    for (let i = 0; i < rendered.length; i++) {
      const { slot, prompt, size } = rendered[i];
      const pct = 10 + Math.round(((i + 1) / rendered.length) * 85);
      emit("job.progress" as EventType, { jobId, progress: pct, message: `生成 ${slot.slotCode}（${slot.purpose}）[${i + 1}/${rendered.length}]` });
      emit("tool.call" as EventType, { jobId, toolName: "generate_image", toolInput: { slotCode: slot.slotCode, purpose: slot.purpose } });

      try {
        console.log(`[pipeline] job=${jobId.slice(0,8)} 生成 ${slot.slotCode} [${i+1}/${rendered.length}] prompt=${prompt.slice(0,60)}`);
        const fileId = crypto.randomUUID();
        const filePath = `/${productId}/template/${slot.slotCode}_${fileId}.png`;
        const facade = Model.image(slot.taskSlotKey).generate({
          prompt,
          referenceImages: srcB64 ? [srcB64] : [],
          size,
        });
        await facade.run();
        const result = await facade.save(filePath, productId, prompt);

        // 更新 media 记录的 slotCode + sortOrder
        db.update(media).set({ slotCode: slot.slotCode, sortOrder: i + 1 }).where(eq(media.id, result.mediaId)).run();

        mediaIds.push(result.mediaId);
        emit("media.completed" as EventType, { jobId, mediaId: result.mediaId });
        emit("tool.result" as EventType, { jobId, toolName: "generate_image", toolResult: { slotCode: slot.slotCode, mediaId: result.mediaId } });
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        emit("tool.result" as EventType, { jobId, toolName: "generate_image", toolResult: { slotCode: slot.slotCode, error: errMsg } });
        // 单图失败不阻断整个套图，继续下一张
      }
    }

    // 6. 完成
    db.update(jobs).set({
      status: "done", progress: 100,
      result: JSON.stringify({ mediaIds, templateId, totalSlots: rendered.length, generated: mediaIds.length }),
      finishedAt: Date.now(),
    }).where(eq(jobs.id, jobId)).run();
    emit("job.completed" as EventType, { jobId, resultMediaIds: mediaIds });
  } catch (e: any) {
    const errMsg = e?.message || String(e);
    db.update(jobs).set({ status: "failed", error: errMsg, finishedAt: Date.now() }).where(eq(jobs.id, jobId)).run();
    emit("job.failed" as EventType, { jobId, error: errMsg });
  }
}
