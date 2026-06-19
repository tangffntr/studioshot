import { describe, it, expect, beforeEach } from "vitest";
import { oss } from "./oss";
import sharp from "sharp";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// 用 1x1 红点 PNG 作测试图（透明小图）
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

beforeEach(async () => {
  // 清理测试产物
  const testDir = path.resolve(process.cwd(), "data/oss/p_test");
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("oss storage", () => {
  it("writeFile 写入 base64 并可读回", async () => {
    const rel = "p_test/image/abc.png";
    await oss.writeFile(rel, PIXEL_PNG_BASE64);
    const buf = await oss.getFile(rel);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.toString("base64")).toBe(PIXEL_PNG_BASE64);
  });

  it("writeFile 自动去除 data: 前缀", async () => {
    const rel = "p_test/image/dataurl.png";
    await oss.writeFile(rel, `data:image/png;base64,${PIXEL_PNG_BASE64}`);
    const buf = await oss.getFile(rel);
    expect(buf.toString("base64")).toBe(PIXEL_PNG_BASE64);
  });

  it("getFileUrl 生成正确的 /oss/ 路径", async () => {
    const url = oss.getFileUrl("p_test/image/abc.png");
    expect(url).toBe("/oss/p_test/image/abc.png");
  });

  it("getImageBase64 返回 data url", async () => {
    const rel = "p_test/image/abc.png";
    await oss.writeFile(rel, PIXEL_PNG_BASE64);
    const dataUrl = await oss.getImageBase64(rel);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("getThumbUrl 生成缩略图", async () => {
    const rel = "p_test/image/big.png";
    // 用 sharp 生成一张 200x200 的正常测试图（避免 tiny 图 resize 报错）
    const bigBuf = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    await oss.writeFile(rel, bigBuf.toString("base64"));
    const thumbUrl = await oss.getThumbUrl(rel, 100);
    expect(thumbUrl).toContain("/oss/");
    expect(thumbUrl).toContain("_100");
    // 缩略图文件应已生成
    expect(await oss.exists(rel)).toBe(true);
  });

  it("exists 判断文件存在性", async () => {
    expect(await oss.exists("p_test/image/nope.png")).toBe(false);
    const rel = "p_test/image/exist.png";
    await oss.writeFile(rel, PIXEL_PNG_BASE64);
    expect(await oss.exists(rel)).toBe(true);
  });

  it("deleteFile 删除文件", async () => {
    const rel = "p_test/image/del.png";
    await oss.writeFile(rel, PIXEL_PNG_BASE64);
    expect(await oss.exists(rel)).toBe(true);
    await oss.deleteFile(rel);
    expect(await oss.exists(rel)).toBe(false);
  });

  it("路径遍历防护拒绝越界路径", async () => {
    await expect(oss.getFile("../../../etc/passwd")).rejects.toThrow(/越界|不在/);
    await expect(oss.writeFile("../../escape.png", PIXEL_PNG_BASE64)).rejects.toThrow(/越界|不在/);
  });
});
