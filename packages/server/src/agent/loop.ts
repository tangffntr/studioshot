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

const MAX_STEPS = 25;

const SYSTEM_PROMPT = `你是一个电商出图 Agent，负责根据用户指令生成电商图片。你是全模态的，可以与用户自由对话，也可以直接生成图片。

核心原则：
- 用户给了产品图（消息中含 media id）→ 先 analyze_product 分析，再 generate_image 出图
- 用户没给产品图，只是描述需求（如"生成一只猫"）→ 直接 generate_image（不传 referenceMediaIds），根据用户描述生成
- 用户只是聊天提问（不需要图片）→ 直接文字回复，不调任何工具

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
}

export interface AgentRunResult {
  finalText: string;
  steps: number;
  toolCalls: string[];
  mediaIds: string[];
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

  // 初始 history（原生 OpenAI 格式）
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: opts.instruction + (opts.initialMediaIds.length ? `\n\n产品图 media id: ${opts.initialMediaIds.join(", ")}` : "") },
  ];

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
      return { finalText: assistantText, steps, toolCalls: toolCallsLog, mediaIds };
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
  return { finalText: "达到最大步数限制", steps, toolCalls: toolCallsLog, mediaIds };
}
