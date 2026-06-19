/**
 * server/agent/loop.ts — 主 Agent 循环（照搬 opencode runner/llm.ts 结构，§5.4）
 *
 * 一个多模态主推理 LLM 驱动循环：
 *   1. streamText/generateText 调主 LLM，附带工具定义
 *   2. 收集 tool_calls
 *   3. 并发执行工具（每个 execute + toModelOutput）
 *   4. 工具结果（含 file 图片）追加到 history
 *   5. 无 tool_call → 结束
 *   bounded by MAX_STEPS
 *
 * 这是首里程碑核心：让主 LLM 能「生图→看回→质检→必要时重试」。
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type CoreMessage } from "ai";
import { listTools } from "../tools/registry";
import { toolsToOpenAIFormat, type Tool, type Content } from "../tools/tool";
import { resolveSlot } from "../model-manager/task-slots";
import { decryptCredentials } from "../model-manager/credentials";
import { getDb } from "../db/client";
import { vendorCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import { eventBus } from "./event-bus";
import type { EventType, SseEvent } from "@ecom/shared";
import type { ToolCtx } from "../tools/tool";

const MAX_STEPS = 25;

const SYSTEM_PROMPT = `你是一个电商出图 Agent。你可以调用工具来分析产品、生成图片、质检。
工作流程：
1. 先用 analyze_product 分析用户上传的产品图
2. 用 generate_image 生成所需图片（传入产品图作参考以保证保真）
3. 用 check_quality 质检生成的图
4. 若质检不通过，调整 prompt 重新 generate_image
5. 全部满意后，用一句话总结你生成了哪些图（media id）

注意：generate_image 后你会在回复里看到生成的图，据此判断是否需要重做。
完成所有工作后，直接回复总结，不再调用工具。`;

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

/** 把工具的 Content[] 转成 AI SDK 消息内容（file→image part） */
function contentToAiParts(contents: Content[]): Array<{ type: "text"; text: string } | { type: "image"; image: string }> {
  return contents.map((c) => {
    if (c.type === "text") return { type: "text" as const, text: c.text };
    // file 内容转 image part（主 LLM 据此"看回"图）
    return { type: "image" as const, image: `data:${c.mime};base64,${c.data}` };
  });
}

/** 获取主推理 LLM 的配置（orchestrator slot） */
function getOrchestratorClient() {
  const resolved = resolveSlot("orchestrator");
  const db = getDb();
  const credRow = db.select().from(vendorCredentials).where(eq(vendorCredentials.vendorId, resolved.vendorId)).all()[0];
  if (!credRow) throw new Error(`主推理 LLM 供应商 ${resolved.vendorId} 未配置凭证`);
  const creds = decryptCredentials(credRow.valuesEnc);
  const client = createOpenAI({ apiKey: creds.apiKey, baseURL: resolved.baseUrl || undefined });
  return { client, model: resolved.modelName };
}

function emit(type: EventType, payload: Record<string, unknown>) {
  eventBus.publish({ type, ...payload });
}

/** 运行一次 Agent 循环 */
export async function runAgentLoop(opts: AgentRunOptions): Promise<AgentRunResult> {
  const { client, model } = getOrchestratorClient();
  const allTools: Tool[] = listTools();
  const toolFormats = toolsToOpenAIFormat(allTools);
  const toolMap = new Map(allTools.map((t) => [t.name, t]));

  const ctx: ToolCtx = {
    jobId: opts.jobId,
    productId: opts.productId,
    emit: (e) => eventBus.publish(e as SseEvent),
  };

  // 初始 history：系统提示 + 用户指令
  const messages: CoreMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: opts.instruction + (opts.initialMediaIds.length ? `\n\n产品图 media id: ${opts.initialMediaIds.join(", ")}` : "") },
  ];

  emit("job.started" as EventType, { jobId: opts.jobId });

  let steps = 0;
  const toolCallsLog: string[] = [];
  const mediaIds: string[] = [];

  while (steps < MAX_STEPS) {
    steps++;
    emit("job.progress" as EventType, { jobId: opts.jobId, progress: Math.min((steps / MAX_STEPS) * 90, 90), message: `Agent 思考中（第${steps}步）` });

    // 调主 LLM
    const result = await generateText({
      model: client(model),
      messages,
      tools: toolFormats as any,
      // 不自动执行工具（我们自己执行以支持 toModelOutput 图片回灌）
    });

    // 收集 assistant 回复
    const assistantText = result.text || "";
    if (assistantText) {
      emit("agent.message" as EventType, { jobId: opts.jobId, text: assistantText });
      messages.push({ role: "assistant", content: assistantText });
    }

    // 收集 tool_calls
    const toolCalls = result.toolCalls || [];
    if (toolCalls.length === 0) {
      // 无工具调用 → 循环结束
      emit("job.progress" as EventType, { jobId: opts.jobId, progress: 100, message: "完成" });
      return { finalText: assistantText, steps, toolCalls: toolCallsLog, mediaIds };
    }

    // 把 assistant 的 tool_call 加入 history（AI SDK 要求）
    messages.push({
      role: "assistant",
      content: toolCalls.map((tc) => ({
        type: "tool-call" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args,
      })),
    } as CoreMessage);

    // 并发执行工具
    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => {
        const tool = toolMap.get(tc.toolName);
        if (!tool) return { toolCallId: tc.toolCallId, toolName: tc.toolName, contents: [{ type: "text" as const, text: `未知工具: ${tc.toolName}` }] };
        emit("tool.call" as EventType, { jobId: opts.jobId, toolName: tc.toolName, toolInput: tc.args });
        toolCallsLog.push(tc.toolName);
        try {
          const output = await tool.execute(tc.args, ctx);
          const contents = tool.toModelOutput(tc.args, output);
          // 收集生成的 media id
          if (tc.toolName === "generate_image" && output && typeof output === "object" && "mediaId" in output) {
            mediaIds.push((output as any).mediaId);
            emit("media.completed" as EventType, { jobId: opts.jobId, mediaId: (output as any).mediaId });
          }
          return { toolCallId: tc.toolCallId, toolName: tc.toolName, contents };
        } catch (e: any) {
          const errMsg = e?.message || String(e);
          emit("tool.result" as EventType, { jobId: opts.jobId, toolName: tc.toolName, toolResult: { error: errMsg } });
          return { toolCallId: tc.toolCallId, toolName: tc.toolName, contents: [{ type: "text" as const, text: `工具执行出错: ${errMsg}` }] };
        }
      })
    );

    // 工具结果回灌 history（含图片 image part，主 LLM 下一回合能看见）
    messages.push({
      role: "tool",
      content: toolResults.map((tr) => {
        const hasImage = tr.contents.some((c) => c.type === "file");
        if (hasImage) {
          // 含图片：用多模态 content
          return {
            type: "tool-result" as const,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            content: contentToAiParts(tr.contents),
          };
        }
        return {
          type: "tool-result" as const,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          content: [{ type: "text" as const, text: tr.contents.map((c) => (c.type === "text" ? c.text : "")).join("\n") }],
        };
      }),
    } as unknown as CoreMessage);
  }

  // 超出最大步数
  emit("job.failed" as EventType, { jobId: opts.jobId, error: `超过最大步数 ${MAX_STEPS}` });
  return { finalText: "达到最大步数限制", steps, toolCalls: toolCallsLog, mediaIds };
}
