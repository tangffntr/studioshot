/**
 * server/agent/pipeline.ts — Pipeline Runner（模板套图确定性驱动）
 *
 * 流程（参考DetailFlow工作流）：
 *   1. analyze_product 获取产品属性（复用 Model.chat + VLM）
 *   2. generateBlueprint 生成8屏页面规划
 *   3. 通过SSE发送规划给前端，等待用户确认
 *   4. 用户确认后，renderAllSlots 渲染全部图位 prompt
 *   5. for slot in slots（确定性遍历）：
 *        Model.image(slot.taskSlotKey).generate({prompt, referenceImages, size}).run().save()
 *        media 记录 slotCode + sortOrder
 *        emit SSE 进度
 *   6. 汇总 mediaIds，job done
 *
 * 与 runAgentLoop 的关系：runner 根据 job.payload.templateId 分流——
 *   有 templateId → runPipelineJob；无 → runAgentLoop（原单图模式）
 */
import * as crypto from "node:crypto";
import { getDb } from "../db/client";
import { templates, templateSlots, media, jobs, models, taskSlots } from "../db/schema";
import { eq } from "drizzle-orm";
import { oss } from "../storage/oss";
import { Model } from "../model-manager/facade";
import { renderAllSlots, type ProductAttributes, type RenderedSlot } from "../template/render";
import { generateStyleLock, applyStyleLock } from "../template/style-lock";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";
import { addTextOverlay, extractTextFromPrompt } from "../storage/text-overlay";
import { generateBlueprint } from "../template/blueprint";
import { resolveOutputSize, getCellSize, type GridSize } from "../utils/size-resolver";

const ANALYZE_PROMPT = `你是一个电商产品分析专家。请分析这张产品图，输出严格的 JSON：
{
  "category": "产品类目（中文，如 马克杯/水杯/衬衫/手机）",
  "attributes": { "color": "主色（中文）", "material": "材质（中文）", "shape": "形状（中文）", "style": "风格（中文）" }
}
只输出 JSON，不要其他文字。`;

/** 图位分组策略：按类型分组（主图H/详情页D/其他） */
function groupSlotsByType(slots: RenderedSlot[]): Map<string, RenderedSlot[]> {
  const groups = new Map<string, RenderedSlot[]>();

  for (const slot of slots) {
    const slotCode = slot.slot.slotCode;
    let groupKey: string;

    if (slotCode.startsWith("H")) {
      groupKey = "hero"; // 主图组
    } else if (slotCode.startsWith("D")) {
      groupKey = "detail"; // 详情页组
    } else {
      groupKey = "other"; // 其他
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(slot);
  }

  return groups;
}

/** 获取网格大小配置 */
function getGridSize(groupKey: string, _slotCount: number): GridSize {
  // 主图（1024x1024）：使用2x2网格
  if (groupKey === "hero") {
    return "2x2";
  }
  // 详情页（1024x2400）：使用1x2网格（纵向拼接）
  if (groupKey === "detail") {
    return "1x2";
  }
  // 其他：默认2x2
  return "2x2";
}

/** 生成网格prompt：将多个图位的prompt合并为一个网格描述 */
function generateGridPrompt(slots: RenderedSlot[], gridSize: string): string {
  const [cols, rows] = gridSize.split("x").map(Number);
  const positions: string[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (index < slots.length) {
        const position = row === 0 ? "上方" : "下方";
        const side = col === 0 ? "左侧" : "右侧";
        positions.push(`${position}${side}区域：${slots[index].prompt}`);
      }
    }
  }

  return `生成一张 ${gridSize} 网格图，白色背景上呈现 ${slots.length} 个不同的产品视角。每个区域之间要有清晰的分隔：\n\n${positions.join("\n\n")}\n\n重要要求：每个区域必须精确为 1024x1024 像素，四个图像之间有清晰的边界。所有区域保持一致的风格和光线。`;
}

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

/** Pipeline 任务执行入口（优化版：网格合并+后端切割+页面规划确认） */
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

    // 3. 生成页面规划（参考DetailFlow工作流）
    emit("job.progress" as EventType, { jobId, progress: 15, message: "生成页面规划..." });
    console.log(`[pipeline] job=${jobId.slice(0,8)} 生成页面规划...`);

    const blueprint = await generateBlueprint({
      productName: tpl.name,
      productCategory: attrs.category || "product",
      productAttributes: attrs,
      platform: tpl.platform || undefined,
    });

    console.log(`[pipeline] job=${jobId.slice(0,8)} 页面规划生成完成，${blueprint.screens.length}屏`);

    // 4. 通过SSE发送规划给前端，等待用户确认
    emit("blueprint.ready" as EventType, {
      jobId,
      blueprint,
      message: "页面规划已生成，请确认后继续",
    });

    // 5. 等待用户确认（通过轮询job状态实现）
    console.log(`[pipeline] job=${jobId.slice(0,8)} 等待用户确认页面规划...`);
    emit("job.progress" as EventType, { jobId, progress: 20, message: "等待用户确认页面规划..." });

    // 轮询等待确认
    let confirmed = false;
    let retryCount = 0;
    const maxRetries = 300; // 最多等待5分钟（300秒）

    while (!confirmed && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 每秒检查一次
      retryCount++;

      // 检查job状态
      const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
      if (!job) throw new Error("任务不存在");

      // 检查是否有确认标记（通过payload中的confirmed字段）
      try {
        const payload = JSON.parse(job.payload || "{}");
        if (payload.blueprintConfirmed === true) {
          confirmed = true;
          console.log(`[pipeline] job=${jobId.slice(0,8)} 用户已确认页面规划`);
        } else if (payload.blueprintRejected === true) {
          // 用户拒绝，重新生成规划
          console.log(`[pipeline] job=${jobId.slice(0,8)} 用户拒绝页面规划，重新生成...`);
          emit("job.progress" as EventType, { jobId, progress: 15, message: "重新生成页面规划..." });

          // 重新生成规划
          const newBlueprint = await generateBlueprint({
            productName: tpl.name,
            productCategory: attrs.category || "product",
            productAttributes: attrs,
            platform: tpl.platform || undefined,
          });

          emit("blueprint.ready" as EventType, {
            jobId,
            blueprint: newBlueprint,
            message: "页面规划已重新生成，请确认",
          });

          // 重置拒绝标记
          db.update(jobs).set({
            payload: JSON.stringify({ ...payload, blueprintRejected: false })
          }).where(eq(jobs.id, jobId)).run();

          retryCount = 0; // 重置计数器
        }
      } catch (e) {
        // 解析失败，继续等待
      }

      // 每10秒发送一次进度
      if (retryCount % 10 === 0) {
        emit("job.progress" as EventType, {
          jobId,
          progress: 20,
          message: `等待用户确认页面规划...(${retryCount}秒)`
        });
      }
    }

    if (!confirmed) {
      throw new Error("等待用户确认超时");
    }

    // 6. 渲染全部图位 prompt + 注入 Campaign Style Lock（整套图风格一致）
    emit("job.progress" as EventType, { jobId, progress: 30, message: "渲染图位prompt..." });
    const rendered: RenderedSlot[] = renderAllSlots(slots as any, attrs);
    const styleLock = generateStyleLock(attrs, tpl.platform || undefined);
    applyStyleLock(rendered, styleLock);
    console.log(`[pipeline] job=${jobId.slice(0,8)} style lock 已生成`);

    // 4. 读源图 base64（图生图参考，保证产品保真）
    const srcMedia = db.select().from(media).where(eq(media.id, sourceMediaId)).all()[0];
    const srcB64 = srcMedia ? await oss.getImageBase64(srcMedia.filePath) : "";

    // 5. 按类型分组，生成网格大图
    const groups = groupSlotsByType(rendered);
    const mediaIds: string[] = [];
    let groupIndex = 0;
    const totalGroups = groups.size;

    // 查询任务槽绑定的模型 cellSize
    const firstSlotKey = rendered[0]?.slot.taskSlotKey || "main-image";
    const slotRow = db.select().from(taskSlots).where(eq(taskSlots.slotKey, firstSlotKey)).all()[0];
    const modelRow = slotRow?.modelId ? db.select().from(models).where(eq(models.id, slotRow.modelId)).all()[0] : null;
    const cellSize = getCellSize(modelRow || {});

    for (const [groupKey, groupSlots] of groups) {
      groupIndex++;
      const progressBase = 10 + Math.round(((groupIndex - 1) / totalGroups) * 80);

      // 确定网格大小：主图用2x2，详情页用1x2
      const gridSize = getGridSize(groupKey, groupSlots.length);
      const gridDimensions = resolveOutputSize(cellSize, gridSize, groupKey);

      emit("job.progress" as EventType, {
        jobId,
        progress: progressBase,
        message: `生成${groupKey === "hero" ? "主图" : "详情页"}组（${groupSlots.length}张，${gridSize}网格，${gridDimensions}）[${groupIndex}/${totalGroups}]`
      });

      try {
        // 计算网格数量：根据图位数量和网格大小，分批生成
        const [cols, rows] = gridSize.split("x").map(Number);
        const cellsPerGrid = cols * rows;
        const gridCount = Math.ceil(groupSlots.length / cellsPerGrid);

        console.log(`[pipeline] job=${jobId.slice(0,8)} ${groupKey}组: ${groupSlots.length}张图, ${gridSize}网格, 需要${gridCount}次API调用`);

        // 分批生成网格
        for (let gridIndex = 0; gridIndex < gridCount; gridIndex++) {
          const startIndex = gridIndex * cellsPerGrid;
          const endIndex = Math.min(startIndex + cellsPerGrid, groupSlots.length);
          const batchSlots = groupSlots.slice(startIndex, endIndex);

          // 如果最后一张不足一个网格，使用1x1单独生成
          const batchGridSize = batchSlots.length === 1 ? "1x1" : gridSize;

          emit("job.progress" as EventType, {
            jobId,
            progress: progressBase + Math.round((gridIndex / gridCount) * (80 / totalGroups)),
            message: `生成${groupKey === "hero" ? "主图" : "详情页"}组（${startIndex + 1}-${endIndex}/${groupSlots.length}，${batchGridSize}网格）`
          });

          // 生成网格prompt
          const gridPrompt = generateGridPrompt(batchSlots, batchGridSize);
          console.log(`[pipeline] job=${jobId.slice(0,8)} 生成${groupKey}组网格 ${gridIndex + 1}/${gridCount} prompt=${gridPrompt.slice(0,100)}...`);

          // 调用API生成网格大图（使用 resolveOutputSize 计算最终尺寸）
          const outputSize = resolveOutputSize(cellSize, batchGridSize, groupKey);
          const facade = Model.image(batchSlots[0].slot.taskSlotKey).generate({
            prompt: gridPrompt,
            referenceImages: srcB64 ? [srcB64] : [],
            size: outputSize,
          });

          console.log(`[pipeline] job=${jobId.slice(0,8)} 开始调用API生成${groupKey}组网格 ${gridIndex + 1}/${gridCount}...`);
          await facade.run(); // 先调用 run() 生成图片
          const gridResult = await facade.save(`/${productId}/template/grid_${groupKey}_${gridIndex}_${crypto.randomUUID()}.png`, productId, gridPrompt, jobId);
          console.log(`[pipeline] job=${jobId.slice(0,8)} ${groupKey}组网格 ${gridIndex + 1}/${gridCount} 生成完成，base64长度: ${gridResult.base64?.length || 0}`);

          // 切割网格大图
          const cells = batchGridSize === "1x1"
            ? [{ base64: gridResult.base64, position: { row: 0, col: 0 } }]
            : await oss.cutGridImage(gridResult.base64, batchGridSize);
          console.log(`[pipeline] job=${jobId.slice(0,8)} ${groupKey}组网格 ${gridIndex + 1}/${gridCount} 切割完成，${cells.length}张子图`);

          // 保存每个子图
          for (let i = 0; i < cells.length && i < batchSlots.length; i++) {
            const cell = cells[i];
            const slot = batchSlots[i];

            const fileId = crypto.randomUUID();
            const filePath = `/${productId}/template/${slot.slot.slotCode}_${fileId}.png`;

            // 检查是否需要叠加文字
            let finalBase64 = cell.base64;
            const textOverlay = extractTextFromPrompt(slot.prompt);
            if (textOverlay) {
              console.log(`[pipeline] job=${jobId.slice(0,8)} ${slot.slot.slotCode} 需要叠加文字: "${textOverlay.text}" 位置: ${textOverlay.position}`);
              try {
                const imageBuffer = Buffer.from(cell.base64, 'base64');
                const resultBuffer = await addTextOverlay(imageBuffer, {
                  text: textOverlay.text,
                  position: textOverlay.position,
                  fontSize: 72,
                  color: 'white',
                });
                finalBase64 = resultBuffer.toString('base64');
                console.log(`[pipeline] job=${jobId.slice(0,8)} ${slot.slot.slotCode} 文字叠加完成`);
              } catch (e: any) {
                console.error(`[pipeline] job=${jobId.slice(0,8)} ${slot.slot.slotCode} 文字叠加失败:`, e.message);
                // 文字叠加失败不影响整体流程，使用原始图片
              }
            }

            // 保存到OSS
            await oss.writeFile(filePath, finalBase64);

            // 创建media记录
            const mediaId = crypto.randomUUID();
            db.insert(media).values({
              id: mediaId,
              productId,
              jobId,
              type: "image",
              filePath,
              promptText: slot.prompt,
              genState: "done",
              slotCode: slot.slot.slotCode,
              sortOrder: slot.slot.sequence,
              createdAt: Date.now(),
            }).run();

            mediaIds.push(mediaId);
            emit("media.completed" as EventType, { jobId, mediaId });
            emit("tool.result" as EventType, {
              jobId,
              toolName: "generate_image",
              toolResult: { slotCode: slot.slot.slotCode, mediaId }
            });

            const pct = progressBase + Math.round(((i + 1) / groupSlots.length) * (80 / totalGroups));
            emit("job.progress" as EventType, {
              jobId,
              progress: pct,
              message: `保存 ${slot.slot.slotCode}（${slot.slot.purpose}）[${i + 1}/${groupSlots.length}]`
            });
          }
        }
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        const errStack = e?.stack || '';
        console.error(`[pipeline] job=${jobId.slice(0,8)} ${groupKey}组生成失败:`, errMsg);
        console.error(`[pipeline] job=${jobId.slice(0,8)} 错误堆栈:`, errStack.slice(0, 500));
        emit("tool.result" as EventType, {
          jobId,
          toolName: "generate_image",
          toolResult: { group: groupKey, error: errMsg }
        });
        // 分组失败不阻断整个套图，继续下一组
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
