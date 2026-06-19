import { describe, it, expect } from "vitest";
import { encryptCredentials, decryptCredentials } from "./credentials";

describe("credentials AES-256-GCM", () => {
  it("加密→解密往返还原原始对象", () => {
    const original = { apiKey: "sk-test-123", baseUrl: "https://x.com/v1" };
    const enc = encryptCredentials(original);
    const dec = decryptCredentials(enc);
    expect(dec).toEqual(original);
  });

  it("加密结果是 base64 字符串且每次不同（含随机 iv）", () => {
    const vals = { apiKey: "sk-1" };
    const e1 = encryptCredentials(vals);
    const e2 = encryptCredentials(vals);
    expect(e1).not.toBe(e2); // iv 随机导致密文不同
    expect(() => Buffer.from(e1, "base64")).not.toThrow();
  });

  it("解密篡改的密文抛错（GCM 完整性校验）", () => {
    const enc = encryptCredentials({ apiKey: "sk-real" });
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // 翻转最后一字节
    const tampered = buf.toString("base64");
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it("多字段凭证往返", () => {
    const vals = { apiKey: "sk-x", baseUrl: "https://y.com", orgId: "123" };
    expect(decryptCredentials(encryptCredentials(vals))).toEqual(vals);
  });
});
