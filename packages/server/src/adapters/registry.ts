/**
 * server/adapters/registry.ts — 适配器注册表
 * 按 vendorId 查找适配器实例。新增供应商在此注册。
 */
import type { VendorAdapter } from "./base";
import { GrsaiAdapter } from "./grsai";
import { OpenAIChatAdapter } from "./openai-chat";

const registry: Record<string, VendorAdapter> = {
  grsai: new GrsaiAdapter(),
  "openai-chat": new OpenAIChatAdapter(),
};

export function getAdapter(vendorId: string): VendorAdapter {
  const a = registry[vendorId];
  if (!a) throw new Error(`未注册的供应商适配器：${vendorId}`);
  return a;
}

export function listAdapters(): string[] {
  return Object.keys(registry);
}
