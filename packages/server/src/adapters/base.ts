/**
 * server/adapters/base.ts — 受控适配器接口（§5.1）
 * 每个供应商一个适配器类，封装"调模型→返回结果"。
 * 凭证从外部注入（由 model-manager 从加密 DB 解密后传入）。
 */

/** 图片生成/编辑请求 */
export interface GenImageRequest {
  model: string;
  prompt: string;
  /** 参考图 base64 数组（图生图保真；空=纯文生图） */
  referenceImages?: string[];
  size?: string; // "1024x1024"
  /** 网格大小（用于套图优化，一次生成多张图） */
  gridSize?: "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2" | "3x3";
}

/** 图片生成结果 */
export interface GenImageResult {
  /** 生成图 base64（不含 data: 前缀） */
  base64: string;
  mime: string;
  /** 本次成本（分，用于计费） */
  cost: number;
  meta?: Record<string, unknown>;
}

/** 文本/视觉模型请求（看图分析、质检） */
export interface ChatRequest {
  model: string;
  prompt: string;
  /** 图片 base64 数组（多模态看图） */
  images?: string[];
}

/** 适配器接口（受控，非任意代码） */
export interface VendorAdapter {
  /** 供应商类别 */
  category: "image" | "vlm" | "video" | "tryon" | "matting";
  /** 图片生成（生图/编辑） */
  generateImage?(req: GenImageRequest, creds: Record<string, string>): Promise<GenImageResult>;
  /** 文本/视觉对话（看图分析、质检） */
  chat?(req: ChatRequest, creds: Record<string, string>): Promise<string>;
}

/** 从 base64 提取 host（去 /v1 后缀） */
export function extractHost(baseUrl: string): string {
  let b = baseUrl.replace(/\/+$/, "");
  const i = b.indexOf("/v1");
  if (i > 0) b = b.slice(0, i);
  return b;
}
