/**
 * server/storage/oss.ts — 本地文件存储抽象（移植 Toonflow oss.ts，去 Electron）
 * 根目录 data/oss/，路径约定 /{productId}/{type}/{uuid}.ext
 * 提供：writeFile（base64 自动解码）/ getFile / getFileUrl / getImageBase64 /
 *      getThumbPath（sharp 缩略图）/ deleteFile / fileExists
 * 路径遍历防护（is-path-inside）。可平滑切 S3（换实现即可）。
 */
import isPathInside from "is-path-inside";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(process.cwd(), "data/oss");
const THUMB_DIR = path.resolve(process.cwd(), "data/oss/smallImage");
const URL_PREFIX = "/oss"; // Express 静态服务挂载点

// 确保根目录存在
fsSync.mkdirSync(ROOT, { recursive: true });
fsSync.mkdirSync(THUMB_DIR, { recursive: true });

/** 规范化用户路径：去前导斜杠，统一分隔符 */
function normalize(userPath: string): string {
  return userPath.replace(/^[/\\]+/, "").split("/").join(path.sep);
}

/** 路径遍历防护：解析后必须仍在 ROOT 内 */
function safeAbs(userPath: string): string {
  const abs = path.join(ROOT, normalize(userPath));
  if (!isPathInside(abs, ROOT)) {
    throw new Error(`路径越界：${userPath} 不在 OSS 根目录内`);
  }
  return abs;
}

/** base64 可能带 data: 前缀，去掉前缀取纯 base64 */
function stripDataUrl(s: string): string {
  const i = s.indexOf(",");
  return i > 0 && s.slice(0, i).includes("base64") ? s.slice(i + 1) : s;
}

export const oss = {
  /** 写文件（content 为 base64，自动解码）。返回规范化后的相对路径。 */
  async writeFile(relPath: string, base64: string): Promise<string> {
    const abs = safeAbs(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(stripDataUrl(base64), "base64"));
    return normalize(relPath).split(path.sep).join("/");
  },

  /** 读文件为 Buffer */
  async getFile(relPath: string): Promise<Buffer> {
    return fs.readFile(safeAbs(relPath));
  },

  /** 读图片为 base64 data url */
  async getImageBase64(relPath: string): Promise<string> {
    const buf = await this.getFile(relPath);
    const ext = path.extname(relPath).slice(1).toLowerCase() || "png";
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  },

  /** 获取 http 访问 URL（由 Express /oss 静态服务） */
  getFileUrl(relPath: string): string {
    const p = normalize(relPath).split(path.sep).join("/");
    return `${URL_PREFIX}/${p}`;
  },

  /** 生成缩略图路径（按需生成，缓存到 smallImage/）。返回 URL。 */
  async getThumbUrl(relPath: string, size = 300): Promise<string> {
    const abs = safeAbs(relPath);
    const thumbName = `${path.basename(relPath, path.extname(relPath))}_${size}${path.extname(relPath)}`;
    const thumbRel = path.relative(ROOT, THUMB_DIR);
    const thumbAbs = path.join(THUMB_DIR, thumbName);
    if (!fsSync.existsSync(thumbAbs)) {
      await sharp(abs).resize(size, size, { fit: "inside" }).jpeg({ quality: 80 }).toFile(thumbAbs);
    }
    return `${URL_PREFIX}/${thumbRel.split(path.sep).join("/")}/${thumbName}`;
  },

  /** 删除文件 */
  async deleteFile(relPath: string): Promise<void> {
    const abs = safeAbs(relPath);
    await fs.unlink(abs).catch(() => {}); // 不存在则忽略
  },

  /** 文件是否存在 */
  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(safeAbs(relPath));
      return true;
    } catch {
      return false;
    }
  },
};

export type Oss = typeof oss;
