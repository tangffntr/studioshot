/**
 * server/model-manager/credentials.ts — 供应商凭证 AES-256-GCM 加密
 * 改进 Toonflow 明文存储（valuesEnc BLOB）。
 * 主密钥从环境变量 MASTER_KEY（32 字节 hex），运行时解密注入适配器。
 */
import * as crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function masterKey(): Buffer {
  const hex = process.env.MASTER_KEY;
  if (!hex || hex.length !== 64) {
    // 开发期允许 fallback（生产必须配 MASTER_KEY）
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境必须设置 MASTER_KEY（32 字节 hex）");
    }
    // 开发用固定 dev key（仅本地）
    return Buffer.from("0".repeat(64), "hex");
  }
  return Buffer.from(hex, "hex");
}

/** 加密凭证 JSON 对象 → 返回 base64 字符串（存 vendor_credentials.values_enc） */
export function encryptCredentials(values: Record<string, string>): string {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(values), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv(12) + tag(16) + enc
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** 解密 → 返回凭证对象 */
export function decryptCredentials(valuesEnc: string): Record<string, string> {
  const key = masterKey();
  const buf = Buffer.from(valuesEnc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}
