// @ecom/shared — 共享类型与 Zod schema（前后端契约的唯一来源）
// 被 server 和 web 共同依赖。任何跨端数据结构只允许在此定义。

// 常量枚举
export * from "./constants";

// 领域类型
export * from "./types";

// Zod schema
export * from "./schemas/tools";
export * from "./schemas/api";

export const PACKAGE_NAME = "@ecom/shared";
