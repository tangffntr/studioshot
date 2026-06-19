/**
 * server/tools/tool.ts — 工具契约 + make 工厂（照搬 opencode tool.ts:36-52）
 *
 * 每个工具声明：description（给主 LLM）、inputSchema（Zod → JSON Schema）、
 * execute（执行逻辑）、toModelOutput（结果如何回灌主 LLM，含图片 file）。
 *
 * toModelOutput 是关键：generate-image 工具返回 {type:"file",data,mime}，
 * 主 LLM 下一回合就能"看见"这张图（A3 假设的工程落地）。
 */
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** 工具内容部分（回灌主 LLM） */
export type Content =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mime: string; name?: string };

/** 工具执行上下文（job/产品信息） */
export interface ToolCtx {
  jobId: string;
  productId: string | null;
  /** 发布事件（供 SSE 推送） */
  emit: (event: { type: string; [key: string]: unknown }) => void;
}

export interface ToolConfig<I, O> {
  description: string;
  input: ZodTypeAny; // 接受任意 Zod schema
  execute: (input: I, ctx: ToolCtx) => Promise<O>;
  /** 结果如何回灌主 LLM（默认：不回灌） */
  toModelOutput?: (input: I, output: O) => Content[];
}

export interface Tool<I = any, O = any> {
  name: string;
  description: string;
  /** 给主 LLM 看的 JSON Schema */
  jsonSchema: Record<string, unknown>;
  execute: (input: I, ctx: ToolCtx) => Promise<O>;
  toModelOutput: (input: I, output: O) => Content[];
}

/** 工具工厂 */
export function make<I, O>(name: string, cfg: ToolConfig<I, O>): Tool<I, O> {
  // zod-to-json-schema 带 name 会用 $ref 引用，不传 name 输出扁平结构（适合直接给 LLM）
  const schema = zodToJsonSchema(cfg.input) as Record<string, unknown>;
  // 确保 type: object（zod object 转 JSON Schema 默认有）
  if (!schema.type) schema.type = "object";
  return {
    name,
    description: cfg.description,
    jsonSchema: schema,
    execute: cfg.execute,
    toModelOutput: cfg.toModelOutput || (() => []),
  };
}

/** 把工具列表转成给主 LLM 的工具定义数组（OpenAI tools 格式） */
export function toolsToOpenAIFormat(tools: Tool[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonSchema,
    },
  }));
}
