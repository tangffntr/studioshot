/**
 * server/storage/cos.ts — 腾讯云 COS 对象存储适配器
 *
 * 用途：把 base64 图片/视频上传到 COS，返回公网可访问 URL，
 * 供云端 API（agnes 视频图生视频、阿里云试穿等）下载使用。
 * 本地 OSS 的图片云端 API 无法访问，故需要 COS 提供公网 URL。
 *
 * 配置（.env）：
 *   COS_SECRET_ID / COS_SECRET_KEY / COS_APP_ID / COS_BUCKET / COS_REGION / COS_PUBLIC_BASE
 *
 * 未配置 COS_* 时 isCosConfigured() 返回 false，调用方可降级处理。
 */
import COS from "cos-nodejs-sdk-v5";
import * as crypto from "node:crypto";

let _cos: COS | null = null;

/** 读取 COS 配置（从环境变量） */
function cosConfig() {
  return {
    secretId: process.env.COS_SECRET_ID,
    secretKey: process.env.COS_SECRET_KEY,
    appId: process.env.COS_APP_ID,
    bucket: process.env.COS_BUCKET, // 形如 opc-assets-1434990316
    region: process.env.COS_REGION, // 形如 ap-shanghai
    publicBase: (process.env.COS_PUBLIC_BASE || "").replace(/\/+$/, ""),
  };
}

/** COS 是否已配置（所有必需参数齐全） */
export function isCosConfigured(): boolean {
  const c = cosConfig();
  return !!(c.secretId && c.secretKey && c.bucket && c.region);
}

/** 获取 COS 单例 */
function getCos(): COS {
  if (_cos) return _cos;
  const c = cosConfig();
  if (!isCosConfigured()) {
    throw new Error("COS 未配置：请在 .env 设置 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION");
  }
  _cos = new COS({
    SecretId: c.secretId!,
    SecretKey: c.secretKey!,
  });
  return _cos;
}

/**
 * 上传 base64 数据到 COS，返回公网可访问 URL。
 * @param base64 纯 base64 或 data URI（data:image/png;base64,...）
 * @param ext 扩展名（如 "png"/"mp4"），用于拼 key 和 Content-Type
 * @param keyPrefix 路径前缀（如 "video/frame"），默认 "uploads"
 * @returns 公网 URL（用自定义域名）
 */
export async function uploadBase64ToCos(
  base64: string,
  ext: string,
  keyPrefix = "uploads"
): Promise<string> {
  const c = cosConfig();
  const cos = getCos();

  // 去掉 data URI 前缀
  const raw = base64.includes(",") ? base64.split(",")[1] : base64;
  const buf = Buffer.from(raw, "base64");

  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const key = `${keyPrefix}/${crypto.randomUUID()}.${safeExt}`;

  // 根据扩展名推断 Content-Type
  const mimeMap: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  const contentType = mimeMap[safeExt] || "application/octet-stream";

  await new Promise<void>((resolve, reject) => {
    cos.putObject({
      Bucket: c.bucket!,
      Region: c.region!,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }, (err) => {
      if (err) reject(new Error(`COS 上传失败: ${err.message || JSON.stringify(err).slice(0, 200)}`));
      else resolve();
    });
  });

  // 用自定义域名拼公网 URL（优先），否则用 COS 默认域名
  if (c.publicBase) {
    return `${c.publicBase}/${key}`;
  }
  return `https://${c.bucket}.cos.${c.region}.myqcloud.com/${key}`;
}

/**
 * 便捷方法：上传 base64 图片，返回公网 URL。
 * 自动判断图片格式（默认 png）。
 */
export async function uploadImageBase64ToCos(base64: string, ext = "png"): Promise<string> {
  return uploadBase64ToCos(base64, ext, "images");
}
