/**
 * server/adapters/openai-chat.ts — OpenAI 兼容对话适配器
 * 用于主推理 LLM / VLM 看图分析 / 质检。
 * 支持 MiMo-V2.5（Phase 0 验证：image part 可正确被识别）。
 * 用 Vercel AI SDK 的 createOpenAI + generateText。
 */
import type { VendorAdapter, ChatRequest } from "./base";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

export class OpenAIChatAdapter implements VendorAdapter {
  category = "vlm" as const;

  async chat(req: ChatRequest, creds: Record<string, string>): Promise<string> {
    const apiKey = creds.apiKey;
    if (!apiKey) throw new Error("OpenAI 兼容端点缺少 apiKey");
    const baseUrl = creds.baseUrl;

    const client = createOpenAI(baseUrl ? { apiKey, baseURL: baseUrl } : { apiKey });

    // 构造多模态消息（有图则带 image part）
    const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
      { type: "text", text: req.prompt },
    ];
    for (const img of req.images || []) {
      content.push({ type: "image", image: img.startsWith("data:") ? img : `data:image/png;base64,${img}` });
    }

    const result = await generateText({
      model: client(req.model),
      messages: [{ role: "user", content }],
    });
    return result.text;
  }
}
