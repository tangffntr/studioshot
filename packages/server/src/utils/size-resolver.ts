/**
 * server/utils/size-resolver.ts — 宫格生图尺寸解析工具
 *
 * 根据模型的 cellSize（基础单元格尺寸）+ gridSize（宫格布局）+ groupKey（图位分组）
 * 自动计算最终输出尺寸。
 *
 * 示例：
 *   cellSize=1024, gridSize="2x2", groupKey="hero"   → "2048x2048"
 *   cellSize=1024, gridSize="1x2", groupKey="detail" → "1024x2468"
 *   cellSize=2048, gridSize="2x2", groupKey="hero"   → "4096x4096"
 *   cellSize=1024, gridSize="3x3", groupKey="hero"   → "3072x3072"
 */

/** 网格大小类型 */
export type GridSize = "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2" | "3x3";

/** 宽高比预设：输入 cellSize，返回 [单格宽, 单格高] */
const ASPECT_RATIOS: Record<string, (cell: number) => [number, number]> = {
  "1:1":  (c) => [c, c],
  "16:9": (c) => [Math.round(c * 16 / 9), c],
  "9:16": (c) => [c, Math.round(c * 16 / 9)],
  "4:3":  (c) => [Math.round(c * 4 / 3), c],
  "3:4":  (c) => [c, Math.round(c * 4 / 3)],
};

/** groupKey → 默认宽高比 */
const GROUP_ASPECT: Record<string, string> = {
  hero: "1:1",      // 主图：正方形
  detail: "3:4",    // 详情页：竖版
  other: "1:1",     // 其他：默认正方形
};

/**
 * 根据 cellSize + gridSize + groupKey 计算最终输出尺寸
 * @param cellSize 基础单元格尺寸（如 1024, 2048, 4096）
 * @param gridSize 宫格布局（如 "2x2", "1x2"）
 * @param groupKey 图位分组（hero/detail/other）
 * @returns 输出尺寸字符串（如 "2048x2048"）
 */
export function resolveOutputSize(cellSize: number, gridSize: GridSize, groupKey: string): string {
  const aspect = GROUP_ASPECT[groupKey] || "1:1";
  const ratioFn = ASPECT_RATIOS[aspect] || ASPECT_RATIOS["1:1"];
  const [cw, ch] = ratioFn(cellSize);
  const [cols, rows] = gridSize.split("x").map(Number);
  return `${cw * cols}x${ch * rows}`;
}

/**
 * 从 models 表查询模型的 cellSize（默认 1024）
 */
export function getCellSize(model: { cellSize?: number | null }): number {
  return model.cellSize || 1024;
}
