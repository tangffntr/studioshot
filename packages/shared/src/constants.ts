/**
 * @ecom/shared — 常量枚举（前后端共用，SSE 事件类型 / 任务状态 / 生成状态）
 * 对应计划 §3.2、§4
 */

/** SSE 事件类型 — 所有进度走单一 /api/events 流 */
export const EventType = {
  JobStarted: "job.started",
  JobProgress: "job.progress",
  ToolCall: "tool.call",
  ToolResult: "tool.result",
  MediaCompleted: "media.completed",
  AgentMessage: "agent.message",
  JobCompleted: "job.completed",
  JobFailed: "job.failed",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

/** Job 任务状态（admit-then-run 状态机） */
export const JobStatus = {
  Queued: "queued",
  Running: "running",
  Done: "done",
  Failed: "failed",
  Canceled: "canceled",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** 媒体生成状态机 */
export const GenState = {
  Queued: "queued",
  Running: "running",
  Done: "done",
  Failed: "failed",
} as const;
export type GenState = (typeof GenState)[keyof typeof GenState];

/** 任务槽 key — 每类能力绑一个模型（§4.1 task_slots） */
export const TaskSlot = {
  Orchestrator: "orchestrator", // 主推理 LLM（多模态）
  Vlm: "vlm", // 看图分析/质检
  MainImage: "main-image", // 主图/场景图生成
  DetailPage: "detail-page", // 详情页生成
  Tryon: "tryon", // 虚拟试穿
  Video: "video", // 视频生成
  Matting: "matting", // 抠图
} as const;
export type TaskSlot = (typeof TaskSlot)[keyof typeof TaskSlot];

/** 媒体类型 */
export const MediaType = {
  Image: "image",
  Video: "video",
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

/** 供应商类别 */
export const VendorCategory = {
  Image: "image",
  Video: "video",
  Tryon: "tryon",
  Vlm: "vlm",
  Matting: "matting",
} as const;
export type VendorCategory = (typeof VendorCategory)[keyof typeof VendorCategory];
