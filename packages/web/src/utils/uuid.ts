/**
 * web/utils/uuid.ts — UUID 生成（兼容非安全上下文）
 *
 * crypto.randomUUID 仅在安全上下文（HTTPS / localhost）可用。
 * 内网 HTTP 部署（如 http://192.168.x.x:4096）下该函数不存在，
 * 直接调用会抛 TypeError。统一走本工具：优先用原生，降级为 RFC4122 v4。
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
