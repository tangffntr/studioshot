/**
 * @ecom/shared — API 请求/响应 Zod schema（§3.1 REST 端点）
 * 前后端共用的请求体验证。
 */
import { z } from "zod";

/** POST /api/products — 上传产品 */
export const CreateProductRequest = z.object({
  name: z.string().min(1),
  imageBase64: z.string().min(1).describe("产品图 base64（不含 data: 前缀）"),
  imageMime: z.string().default("image/png"),
  category: z.string().optional(),
});
export type CreateProductRequest = z.infer<typeof CreateProductRequest>;

export const CreateProductResponse = z.object({
  productId: z.string(),
  mediaId: z.string().describe("白底产品图对应的 media id"),
});
export type CreateProductResponse = z.infer<typeof CreateProductResponse>;

/** POST /api/jobs — 提交任务（admit-then-run，立即返回 jobId） */
export const CreateJobRequest = z.object({
  productId: z.string().describe("关联产品"),
  instruction: z.string().min(1).describe("自然语言指令，如『生成一张亚马逊主图』"),
  attachments: z.array(z.string()).optional().describe("附带的 media id"),
  templateId: z.string().optional().describe("模板 id（有则走 pipeline 套图模式）"),
  mode: z.enum(["agent", "pipeline", "scene-swap"]).default("agent").describe("agent=主LLM，pipeline=套图，scene-swap=保构图换产品"),
  referenceScene: z.string().optional().describe("scene-swap 模式：对标场景图 mediaId"),
  product: z.string().optional().describe("scene-swap 模式：要替换进去的产品图 mediaId"),
});
export type CreateJobRequest = z.infer<typeof CreateJobRequest>;

export const CreateJobResponse = z.object({
  jobId: z.string(),
});
export type CreateJobResponse = z.infer<typeof CreateJobResponse>;

/** POST /api/models/task-slots — 绑定模型到任务槽 */
export const BindTaskSlotRequest = z.object({
  slotKey: z.string(),
  modelId: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type BindTaskSlotRequest = z.infer<typeof BindTaskSlotRequest>;

/** PUT /api/models/vendors/:id/credentials — 更新供应商凭证 */
export const UpdateCredentialsRequest = z.object({
  values: z.record(z.string(), z.string()).describe("凭证键值，如 { apiKey: 'sk-...' }"),
});
export type UpdateCredentialsRequest = z.infer<typeof UpdateCredentialsRequest>;
