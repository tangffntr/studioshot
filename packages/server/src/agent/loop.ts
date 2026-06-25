/**
 * server/agent/loop.ts — 主 Agent 循环（照搬 opencode runner/llm.ts 结构，§5.4）
 *
 * 一个多模态主推理 LLM 驱动循环（原生 OpenAI chat/completions，兼容 MiMo）：
 *   1. 调主 LLM，附带 tools 定义
 *   2. 收集 tool_calls
 *   3. 执行工具（每个 execute + toModelOutput）
 *   4. 工具结果（含 file 图片）追加到 history
 *   5. 无 tool_call → 结束
 *   bounded by MAX_STEPS
 *
 * 这是首里程碑核心：让主 LLM 能「生图→看回→质检→必要时重试」。
 */
import { listTools } from "../tools/registry";
import type { Tool, Content } from "../tools/tool";
import { withRetry } from "../utils/retry";
import { resolveSlot } from "../model-manager/task-slots";
import { decryptCredentials } from "../model-manager/credentials";
import { getDb } from "../db/client";
import { vendorCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";
import type { ToolCtx } from "../tools/tool";
import { readMediaBase64 } from "../tools/generate-image";

const MAX_STEPS = 25;

const SYSTEM_PROMPT = `你是一个电商出图 Agent，负责根据用户指令生成电商图片。你是全模态的，可以与用户自由对话，也可以直接生成图片。

核心原则：
- 用户给了产品图（消息中含 media id 或图片）→ 先 analyze_product 分析，再 generate_image 出图
- 用户没给产品图，只是描述需求（如"生成一只猫"）→ 直接 generate_image（不传 referenceMediaIds），根据用户描述生成
- 用户只是聊天提问（不需要图片）→ 直接文字回复，不调任何工具

⭐ 多图融合规则（非常重要）：
- 用户消息可能含多张图片：第 1 张是产品图（主图），其余是参考素材图（如场景/背景/模特/风格图）
- 生成图片时，必须把"产品图 + 所有参考素材图"一并放入 generate_image 的 referenceMediaIds 数组，实现多图融合
- 融合示例：产品图(杯子) + 参考素材(窗台场景) → 把杯子放进窗台场景；产品图(衣服) + 参考素材(模特) → 让模特穿上该衣服
- 产品图是核心，必须保持其外观保真；参考素材图用于确定场景/背景/构图/模特等
- 若用户明确说"只用产品图"或参考素材与需求无关，可只带产品图

⭐ 续接对话规则（非常重要）：
- 当用户消息中包含"重要提示：上面是上次生成的产品图片"时，说明这是续接对话
- 此时必须将提示中指定的 mediaId 放入 generate_image 的 referenceMediaIds 数组
- 这是图生图的关键：用上文的产品图作为参考，保持产品外观一致性
- 即使用户只是说"换个场景"、"换个背景"，也要带上 referenceMediaIds

⭐ 文字叠加规则（非常重要）：
- 电商图片经常需要叠加文字（如促销信息、产品名称、价格、卖点等）
- 在 generate_image 的 prompt 中，如果需要叠加文字，请使用以下格式：
  "在[位置]添加文字'[内容]'"
- 支持的位置：左上角、右上角、左下角、右下角、居中、顶部、底部
- 示例：
  - "在底部添加文字'限时特惠 仅售99元'"
  - "在左上角写上'新品上市'"
  - "在右下角标注'仅限今日'"
- 叠加的文字会在后处理阶段被准确渲染到图片上，确保100%准确
- 如果用户明确指定了文字内容和位置，按用户要求添加
- 如果用户没有指定，根据产品特点和场景自动推断合适的文字

工作流程（有产品图时）：
1. analyze_product 分析产品图（只调一次）
2. generate_image 生成图片（传入产品图 referenceMediaIds 保证保真）
3. check_quality 质检
4. 通过→总结结束；不通过→最多重试1次

工作流程（无产品图，纯描述出图时）：
1. 直接 generate_image（referenceMediaIds 传空数组，按用户描述生成）
2. check_quality 质检
3. 通过→总结结束

收敛规则：
- 最多生成 2 张图，之后必须文字总结并结束
- generate_image 后你会看到生成的图，据此判断
- 不需要图片时直接文字回复`;

export interface AgentRunOptions {
  jobId: string;
  productId: string | null;
  /** 用户的初始指令 */
  instruction: string;
  /** 初始附带的产品图 media id（作为上下文） */
  initialMediaIds: string[];
  /** 续接模式：之前的消息历史（OpenAI 格式） */
  previousMessages?: any[];
  /** 续接模式：上次生成的图片 mediaId（自动作为参考图） */
  lastGeneratedMediaId?: string | null;
}

export interface AgentRunResult {
  finalText: string;
  steps: number;
  toolCalls: string[];
  mediaIds: string[];
  /** 完整的消息历史（用于续接对话） */
  conversationHistory: any[];
}

/** 获取主推理 LLM 的配置（orchestrator slot）— 返回原生 fetch 所需 */
function getOrchestratorConfig() {
  const resolved = resolveSlot("orchestrator");
  const db = getDb();
  const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, resolved.vendorId)).all()[0];
  if (!credRow) throw new Error(`主推理 LLM 供应商 ${resolved.vendorId} 未配置凭证`);
  const creds = decryptCredentials(credRow.valuesEnc);
  const baseUrl = (resolved.baseUrl || "").replace(/\/+$/, "");
  return { apiKey: creds.apiKey, baseUrl, model: resolved.modelName };
}

/** 原生调 OpenAI 兼容 chat/completions（支持 tools + 多模态 image part） */
async function callLLM(
  cfg: { apiKey: string; baseUrl: string; model: string },
  messages: any[],
  tools: any[]
): Promise<{ text: string; toolCalls: any[] }> {
  const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0.7 };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const res = await withRetry(() => fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  }));
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`主 LLM 调用失败 ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as any;
  const msg = data?.choices?.[0]?.message;
  const text = msg?.content || "";
  const toolCalls = (msg?.tool_calls || []).map((tc: any) => ({
    toolCallId: tc.id,
    toolName: tc.function?.name,
    args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
  }));
  return { text, toolCalls };
}

function emit(type: EventType, payload: Record<string, unknown>) {
  eventBus.publish({ type, ...payload });
}

/** 运行一次 Agent 循环 */
export async function runAgentLoop(opts: AgentRunOptions): Promise<AgentRunResult> {
  const cfg = getOrchestratorConfig();
  const allTools: Tool[] = listTools();
  const toolMap = new Map(allTools.map((t) => [t.name, t]));

  // 原生 OpenAI tools 格式（文档证实 MiMo 支持）
  const openaiTools = allTools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.jsonSchema },
  }));

  const ctx: ToolCtx = {
    jobId: opts.jobId,
    productId: opts.productId,
    emit: (e) => eventBus.publish(e as SseEvent),
  };

  // 判断是续接模式还是新对话模式
  const isContinuation = opts.previousMessages && opts.previousMessages.length > 0;

  // 初始 history（原生 OpenAI 格式）
  let messages: any[];
  if (isContinuation) {
    // 续接模式：使用之前的消息历史 + 新的用户消息
    messages = [...opts.previousMessages!];
    // 构建续接的用户消息（包含上次生成的图片作为参考）
    let userContent = opts.instruction;
    if (opts.lastGeneratedMediaId) {
      // 读取上次生成的图片并作为参考图
      try {
        const lastImageBase64 = await readMediaBase64(opts.lastGeneratedMediaId);
        // readMediaBase64 返回的已经是 data:image/png;base64,xxx 格式，不需要再添加前缀
        const imageUrl = lastImageBase64.startsWith("data:") ? lastImageBase64 : `data:image/png;base64,${lastImageBase64}`;

        // 添加图片到用户消息（多模态格式）
        messages.push({
          role: "user",
          content: [
            { type: "text", text: userContent },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        });
        // ⭐ 明确告诉 LLM：这是上次的产品图，生成新图时必须作为 referenceMediaIds 传入
        messages.push({
          role: "user",
          content: `重要提示：上面是上次生成的产品图片（mediaId: ${opts.lastGeneratedMediaId}）。
当调用 generate_image 工具时，必须将 "${opts.lastGeneratedMediaId}" 放入 referenceMediaIds 数组中，以确保产品外观一致性。
用户要求：${userContent}`,
        });
      } catch (e) {
        // 读取失败则只用文本
        messages.push({ role: "user", content: userContent });
      }
    } else {
      messages.push({ role: "user", content: userContent });
    }
  } else {
    // 新对话模式
    messages = [{ role: "system", content: SYSTEM_PROMPT }];

    // ⭐ 多图融合：把产品图 + 参考素材图都读成 base64，作为多模态图片喂给主 LLM
    // 第 1 张是产品图（主图），其余是参考素材（场景/背景/模特等）
    if (opts.initialMediaIds.length > 0) {
      const imageParts: any[] = [];
      const idLabels: string[] = [];
      for (let i = 0; i < opts.initialMediaIds.length; i++) {
        const mid = opts.initialMediaIds[i];
        try {
          const b64 = await readMediaBase64(mid);
          const url = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
          imageParts.push({ type: "image_url", image_url: { url } });
          idLabels.push(i === 0 ? `产品图(id:${mid})` : `参考素材${i}(id:${mid})`);
        } catch (e: any) {
          // 单张图读取失败不阻断，仅记录
          console.error(`[agent] 读取参考图 ${mid} 失败:`, e?.message);
        }
      }

      if (imageParts.length > 0) {
        const roleText = imageParts.length === 1
          ? "以下是用户提供的产品图："
          : `以下是用户提供的产品图和参考素材图（第1张为产品图，其余为参考素材）。图片顺序：${idLabels.join("、")}`;
        messages.push({
          role: "user",
          content: [
            { type: "text", text: `${opts.instruction}\n\n${roleText}` },
            ...imageParts,
          ],
        });
      } else {
        // 图片全部读取失败，退化为纯文本（保留 id 供 LLM 决策）
        messages.push({
          role: "user",
          content: opts.instruction + (opts.initialMediaIds.length ? `\n\n参考图 id: ${opts.initialMediaIds.join(", ")}（图片读取失败，请按用户描述生成）` : ""),
        });
      }
    } else {
      messages.push({ role: "user", content: opts.instruction });
    }
  }

  emit("job.started" as EventType, { jobId: opts.jobId });

  let steps = 0;
  const toolCallsLog: string[] = [];
  const mediaIds: string[] = [];

  while (steps < MAX_STEPS) {
    steps++;
    console.log(`[agent] job=${opts.jobId.slice(0,8)} step=${steps}`);
    emit("job.progress" as EventType, { jobId: opts.jobId, progress: Math.min((steps / MAX_STEPS) * 90, 90), message: `Agent 思考中（第${steps}步）` });

    // 原生调主 LLM（支持 tools + tool_choice:auto）
    const { text: assistantText, toolCalls } = await callLLM(cfg, messages, openaiTools);

    if (assistantText && assistantText !== "(调用工具中)") {
      emit("agent.message" as EventType, { jobId: opts.jobId, text: assistantText });
    }

    if (toolCalls.length === 0) {
      // 无工具调用 → 循环结束
      console.log(`[agent] job=${opts.jobId.slice(0,8)} 完成 step=${steps}`);
      emit("job.progress" as EventType, { jobId: opts.jobId, progress: 100, message: "完成" });
      return { finalText: assistantText, steps, toolCalls: toolCallsLog, mediaIds, conversationHistory: messages };
    }

    // assistant 消息含 tool_calls（原生 OpenAI 格式：tool_calls 在 message 上）
    // MiMo 严格要求 content 非空（不接受 null），给占位文本
    messages.push({
      role: "assistant",
      content: assistantText || "(调用工具中)",
      tool_calls: toolCalls.map((tc) => ({
        id: tc.toolCallId,
        type: "function",
        function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
      })),
    });

    // 并发执行工具
    for (const tc of toolCalls) {
      const tool = toolMap.get(tc.toolName);
      emit("tool.call" as EventType, { jobId: opts.jobId, toolName: tc.toolName, toolInput: tc.args });
      toolCallsLog.push(tc.toolName);

      let toolContents: Content[];
      try {
        const output = await tool!.execute(tc.args, ctx);
        toolContents = tool!.toModelOutput(tc.args, output);
        if (tc.toolName === "generate_image" && output && typeof output === "object" && "mediaId" in output) {
          mediaIds.push((output as any).mediaId);
          emit("media.completed" as EventType, { jobId: opts.jobId, mediaId: (output as any).mediaId });
        }
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        console.error(`[agent] 工具 ${tc.toolName} 出错:`, errMsg);
        emit("tool.result" as EventType, { jobId: opts.jobId, toolName: tc.toolName, toolResult: { error: errMsg } });
        toolContents = [{ type: "text", text: `工具执行出错: ${errMsg}` }];
      }

      // 工具结果回灌：
      // tool message 只放纯文本（OpenAI 标准 tool role 不支持多模态 content，
      // MiMo 严格遵循标准会报 text is not set）
      const textParts = toolContents.filter((c) => c.type === "text").map((c) => (c as any).text || "");
      const imageParts = toolContents.filter((c) => c.type === "file");

      messages.push({
        role: "tool",
        tool_call_id: tc.toolCallId,
        content: textParts.join("\n") || "(无文本输出)",
      });

      // 若工具产生图片，作为独立的 user message 回灌（user role 支持多模态 image_url）
      // 主 LLM 下一回合能"看见"这张图（A3 闭环）
      if (imageParts.length > 0) {
        const userContent: any[] = [{ type: "text", text: `这是工具 ${tc.toolName} 生成的图片，请查看：` }];
        for (const img of imageParts) {
          userContent.push({ type: "image_url", image_url: { url: `data:${(img as any).mime};base64,${(img as any).data}` } });
        }
        messages.push({ role: "user", content: userContent });
      }
    }
  }

  // 超出最大步数
  emit("job.failed" as EventType, { jobId: opts.jobId, error: `超过最大步数 ${MAX_STEPS}` });
  return { finalText: "达到最大步数限制", steps, toolCalls: toolCallsLog, mediaIds, conversationHistory: messages };
}
