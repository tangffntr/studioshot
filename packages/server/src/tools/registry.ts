/**
 * server/tools/registry.ts — 工具注册表
 * 注册 3 个 MVP 工具，供 Agent 循环按名查找。
 */
import type { Tool } from "./tool";
import { generateImageTool } from "./generate-image";
import { analyzeProductTool } from "./analyze-product";
import { checkQualityTool } from "./check-quality";

const registry: Record<string, Tool> = {
  generate_image: generateImageTool,
  analyze_product: analyzeProductTool,
  check_quality: checkQualityTool,
};

export function getTool(name: string): Tool {
  const t = registry[name];
  if (!t) throw new Error(`未注册的工具：${name}`);
  return t;
}

export function listTools(): Tool[] {
  return Object.values(registry);
}
