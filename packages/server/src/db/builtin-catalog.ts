/**
 * server/db/builtin-catalog.ts — 内置供应商目录加载（声明式 providers.builtin.json）
 * 参考 ZCode builtin 配置思路：目录数据与 seed 逻辑分离，改目录不改代码。
 * 路径解析兼容 src（tsx/vitest）与 dist 两种运行位置：__dirname 均为 <pkg>/src|dist/db。
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface BuiltinModelSpec {
  modelName: string;
  /** 模型名可被 .env 覆盖（如 ORCHESTRATOR_MODEL） */
  modelNameEnv?: string;
  displayName: string;
  type: string;
  modes: string[];
  cellSize?: number;
}

export interface BuiltinVendorSpec {
  id: string;
  name: string;
  category: string;
  adapter: string;
  /** 静态默认 baseUrl（可被 baseUrlEnv 覆盖） */
  baseUrl: string | null;
  baseUrlEnv?: string;
  /** 首次启动时从该 env 变量引导凭证（如 OPENAI_API_KEY） */
  credEnv?: string;
  inputs: Array<{ key: string; label: string; type: string; required?: boolean }>;
  models: BuiltinModelSpec[];
}

export interface BuiltinTaskSlotSpec {
  slotKey: string;
  vendorId: string;
  /** 绑定 vendor.models 的第几个模型（默认 0） */
  modelIndex?: number;
}

export interface BuiltinCatalog {
  schemaVersion: number;
  vendors: BuiltinVendorSpec[];
  taskSlots: BuiltinTaskSlotSpec[];
}

const CATALOG_PATH = path.resolve(__dirname, "../../config/providers.builtin.json");

let cached: BuiltinCatalog | null = null;

/** 解析模型实际名（env 覆盖 > 静态默认） */
export function resolveModelName(m: BuiltinModelSpec): string {
  return (m.modelNameEnv && process.env[m.modelNameEnv]) || m.modelName;
}

/** 解析供应商生效 baseUrl（env 覆盖 > 静态默认） */
export function resolveBaseUrl(v: BuiltinVendorSpec): string | null {
  const fromEnv = v.baseUrlEnv && process.env[v.baseUrlEnv];
  return fromEnv || v.baseUrl || null;
}

/** 模型完整 ID（vendorId:modelName，与既有约定一致） */
export function modelIdOf(vendorId: string, m: BuiltinModelSpec): string {
  return `${vendorId}:${resolveModelName(m)}`;
}

function validate(catalog: BuiltinCatalog): void {
  if (catalog.schemaVersion !== 1) throw new Error(`providers.builtin.json schemaVersion 不支持: ${catalog.schemaVersion}`);
  if (!Array.isArray(catalog.vendors) || catalog.vendors.length === 0) throw new Error("providers.builtin.json vendors 不能为空");
  const seenVendor = new Set<string>();
  for (const v of catalog.vendors) {
    for (const field of ["id", "name", "category", "adapter"] as const) {
      if (!v[field]) throw new Error(`内置供应商缺少字段 ${field}: ${JSON.stringify(v).slice(0, 80)}`);
    }
    if (seenVendor.has(v.id)) throw new Error(`内置供应商 ID 重复: ${v.id}`);
    seenVendor.add(v.id);
    if (!Array.isArray(v.models) || v.models.length === 0) throw new Error(`内置供应商 ${v.id} 未定义模型`);
    for (const m of v.models) {
      if (!m.modelName) throw new Error(`供应商 ${v.id} 存在缺少 modelName 的模型`);
    }
  }
  for (const s of catalog.taskSlots || []) {
    if (!s.slotKey || !s.vendorId) throw new Error(`taskSlot 定义不完整: ${JSON.stringify(s)}`);
    if (!seenVendor.has(s.vendorId)) throw new Error(`taskSlot ${s.slotKey} 引用了不存在的供应商 ${s.vendorId}`);
  }
}

/** 加载（带缓存）内置目录；文件缺失/不合法时启动即失败 */
export function loadBuiltinCatalog(): BuiltinCatalog {
  if (cached) return cached;
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`内置供应商目录不存在: ${CATALOG_PATH}（providers.builtin.json 需随包分发，检查构建产物）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8"));
  } catch (e) {
    throw new Error(`内置供应商目录 JSON 解析失败: ${CATALOG_PATH}: ${(e as Error).message}`);
  }
  const catalog = parsed as BuiltinCatalog;
  validate(catalog);
  cached = catalog;
  return catalog;
}
