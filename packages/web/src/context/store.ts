/**
 * web/src/context/store.ts — 全局状态
 * 聊天消息流 + jobs 历史列表 + SSE 归约 + 页面规划确认
 */
import { createStore } from "solid-js/store";
import type { SseEvent } from "@ecom/shared";
import type { PageBlueprint, VisualSamplePackage } from "@ecom/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool" | "media" | "system";
  text?: string;
  toolName?: string;
  mediaId?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video"; // ⭐ 媒体类型
  slotCode?: string;
  promptText?: string; // ⭐ 该图生成时的 prompt（产出栏/消息流展示+编辑）
  ts: number;
}

export interface OutputMedia {
  id: string;
  url: string;
  promptText: string | null;
  slotCode: string | null;
  sortOrder: number | null;
}

export interface CanvasItem {
  id: string;
  mediaId: string;
  url: string;
  promptText: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface JobSummary {
  id: string;
  productId: string | null;
  productName: string | null;
  type: string;
  instruction: string;
  status: string;
  progress: number;
  createdAt: number;
  finishedAt: number | null;
}

interface AppState {
  currentJobId: string | null;
  jobStatus: string | null;
  jobProgress: number;
  messages: ChatMessage[];
  outputMedia: OutputMedia[]; // ⭐ 当前 job 产出（右侧栏）
  jobs: JobSummary[];
  connected: boolean;
  /** 续接模式：新产出追加而非替换 */
  isContinuation: boolean;
  /** 画布项目列表 */
  canvasItems: CanvasItem[];
  /** 当前选中的画布项目ID */
  selectedCanvasItemId: string | null;
  /** 待确认的页面规划 */
  pendingBlueprint: PageBlueprint | null;
  /** 待确认的视觉样本包 */
  pendingVisualSample: VisualSamplePackage | null;
  /** 确认状态 */
  confirmationStatus: "none" | "blueprint_pending" | "visual_sample_pending";
}

const [state, setState] = createStore<AppState>({
  currentJobId: null,
  jobStatus: null,
  jobProgress: 0,
  messages: [],
  outputMedia: [],
  jobs: [],
  connected: false,
  isContinuation: false,
  canvasItems: [],
  selectedCanvasItemId: null,
  pendingBlueprint: null,
  pendingVisualSample: null,
  confirmationStatus: "none",
});

export { state, setState };

let evtSource: EventSource | null = null;

export function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource("/api/events");
  evtSource.onopen = () => setState("connected", true);
  evtSource.onerror = () => { setState("connected", false); setTimeout(() => connectSSE(), 3000); };
  evtSource.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)); } catch {} };
}

/** 加载历史 job 列表 */
export async function loadJobs() {
  try { setState("jobs", await fetch("/api/jobs").then((r) => r.json())); } catch {}
}

/** 加载某个历史 job 的对话（重建消息流 + 产出物） */
export async function loadJobConversation(jobId: string) {
  try {
    const job = await fetch(`/api/jobs/${jobId}`).then((r) => r.json());
    const mediaList = await fetch(`/api/media?jobId=${jobId}`).then((r) => r.json());

    // 重建消息流
    const msgs: ChatMessage[] = [];
    msgs.push({ id: crypto.randomUUID(), role: "user", text: job.instruction, ts: job.createdAt });
    if (job.error) msgs.push({ id: crypto.randomUUID(), role: "system", text: `任务失败：${job.error}`, ts: job.finishedAt || job.createdAt });
    // 产出图作为 media 消息
    const outputs: OutputMedia[] = mediaList.map((m: any) => ({
      id: m.id, url: m.url, promptText: m.promptText, slotCode: m.slotCode, sortOrder: m.sortOrder,
    }));
    for (const m of mediaList) {
      msgs.push({ id: crypto.randomUUID(), role: "media", mediaId: m.id, mediaUrl: m.url, mediaType: m.type || "image", slotCode: m.slotCode, promptText: m.promptText, ts: m.createdAt });
    }
    // 完成总结
    if (job.status === "done" && job.result) {
      try {
        const r = JSON.parse(job.result);
        if (r.text) msgs.push({ id: crypto.randomUUID(), role: "agent", text: r.text, ts: job.finishedAt || job.createdAt });
      } catch {}
    }

    setState("currentJobId", jobId);
    setState("jobStatus", job.status);
    setState("jobProgress", job.progress || 0);
    setState("messages", msgs);
    setState("outputMedia", outputs);
  } catch {}
}

/** 新建对话（清空当前消息） */
export function newConversation() {
  setState("currentJobId", null);
  setState("jobStatus", null);
  setState("jobProgress", 0);
  setState("messages", []);
  setState("outputMedia", []);
  setState("isContinuation", false);
  setState("pendingBlueprint", null);
  setState("pendingVisualSample", null);
  setState("confirmationStatus", "none");
}

/** 设置待确认的页面规划 */
export function setPendingBlueprint(blueprint: PageBlueprint) {
  setState("pendingBlueprint", blueprint);
  setState("confirmationStatus", "blueprint_pending");
  push({
    id: crypto.randomUUID(),
    role: "system",
    text: "📋 页面规划已生成，请确认后继续",
    ts: Date.now(),
  });
}

/** 设置待确认的视觉样本包 */
export function setPendingVisualSample(sample: VisualSamplePackage) {
  setState("pendingVisualSample", sample);
  setState("confirmationStatus", "visual_sample_pending");
  push({
    id: crypto.randomUUID(),
    role: "system",
    text: "🎨 视觉样本已生成，请确认后继续",
    ts: Date.now(),
  });
}

/** 确认页面规划 */
export async function approveBlueprint(feedback?: string) {
  const jobId = state.currentJobId;
  if (!jobId) return;

  try {
    await fetch(`/api/jobs/${jobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "blueprint", status: "approved", feedback }),
    });
    setState("confirmationStatus", "none");
    setState("pendingBlueprint", null);
    push({
      id: crypto.randomUUID(),
      role: "system",
      text: "✅ 页面规划已确认，开始生成图片",
      ts: Date.now(),
    });
  } catch (e) {
    console.error("确认失败", e);
  }
}

/** 拒绝页面规划 */
export async function rejectBlueprint(feedback: string) {
  const jobId = state.currentJobId;
  if (!jobId) return;

  try {
    await fetch(`/api/jobs/${jobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "blueprint", status: "rejected", feedback }),
    });
    setState("confirmationStatus", "none");
    setState("pendingBlueprint", null);
    push({
      id: crypto.randomUUID(),
      role: "system",
      text: "❌ 页面规划已拒绝，正在重新规划",
      ts: Date.now(),
    });
  } catch (e) {
    console.error("拒绝失败", e);
  }
}

/** 确认视觉样本 */
export async function approveVisualSample(feedback?: string) {
  const jobId = state.currentJobId;
  if (!jobId) return;

  try {
    await fetch(`/api/jobs/${jobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "visual_sample", status: "approved", feedback }),
    });
    setState("confirmationStatus", "none");
    setState("pendingVisualSample", null);
    push({
      id: crypto.randomUUID(),
      role: "system",
      text: "✅ 视觉样本已确认，开始生成剩余图片",
      ts: Date.now(),
    });
  } catch (e) {
    console.error("确认失败", e);
  }
}

/** 拒绝视觉样本 */
export async function rejectVisualSample(feedback: string) {
  const jobId = state.currentJobId;
  if (!jobId) return;

  try {
    await fetch(`/api/jobs/${jobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "visual_sample", status: "rejected", feedback }),
    });
    setState("confirmationStatus", "none");
    setState("pendingVisualSample", null);
    push({
      id: crypto.randomUUID(),
      role: "system",
      text: "❌ 视觉样本已拒绝，正在调整",
      ts: Date.now(),
    });
  } catch (e) {
    console.error("拒绝失败", e);
  }
}

/** 添加画布项目 */
export function addCanvasItem(media: { id: string; url: string; promptText: string | null }) {
  const newItem: CanvasItem = {
    id: crypto.randomUUID(),
    mediaId: media.id,
    url: media.url,
    promptText: media.promptText,
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
    width: 200,
    height: 200,
  };
  setState("canvasItems", (items) => [...items, newItem]);
  return newItem.id;
}

/** 更新画布项目位置 */
export function updateCanvasItemPosition(id: string, x: number, y: number) {
  setState("canvasItems", (item) => item.id === id, { x, y });
}

/** 选中画布项目 */
export function selectCanvasItem(id: string | null) {
  setState("selectedCanvasItemId", id);
}

/** 删除画布项目 */
export function removeCanvasItem(id: string) {
  setState("canvasItems", (items) => items.filter((item) => item.id !== id));
  if (state.selectedCanvasItemId === id) {
    setState("selectedCanvasItemId", null);
  }
}

/** 更新画布项目的提示词 */
export function updateCanvasItemPrompt(id: string, promptText: string) {
  setState("canvasItems", (item) => item.id === id, { promptText });
}

function push(msg: ChatMessage) { setState("messages", (m) => [...m, msg]); }

function handleEvent(evt: SseEvent) {
  if (state.currentJobId && evt.jobId && evt.jobId !== state.currentJobId) return;
  switch (evt.type) {
    case "job.started":
      setState("jobStatus", "running");
      // 续接模式时添加分隔线
      if (state.isContinuation) {
        push({ id: crypto.randomUUID(), role: "system", text: "─── 续接对话 ───", ts: Date.now() });
      } else {
        push({ id: crypto.randomUUID(), role: "system", text: "任务开始", ts: Date.now() });
      }
      break;
    case "job.progress":
      setState("jobProgress", evt.progress || 0);
      if (evt.message) push({ id: crypto.randomUUID(), role: "system", text: evt.message, ts: Date.now() });
      break;
    case "agent.message":
      if (evt.text) push({ id: crypto.randomUUID(), role: "agent", text: evt.text, ts: Date.now() });
      break;
    case "tool.call":
      push({ id: crypto.randomUUID(), role: "tool", toolName: evt.toolName, text: `调用 ${evt.toolName}`, ts: Date.now() });
      break;
    case "tool.result":
      push({ id: crypto.randomUUID(), role: "tool", toolName: evt.toolName, text: `${evt.toolName} 完成`, ts: Date.now() });
      break;
    case "media.completed":
      if (evt.mediaId) {
        fetch(`/api/media/${evt.mediaId}`).then((r) => r.json()).then((m: any) => {
          if (m) {
            setState("outputMedia", (om) => [...om, { id: m.id, url: m.url, promptText: m.promptText, slotCode: m.slotCode, sortOrder: m.sortOrder }]);
            push({ id: crypto.randomUUID(), role: "media", mediaId: m.id, mediaUrl: m.url, mediaType: m.type || "image", slotCode: m.slotCode, promptText: m.promptText, ts: Date.now() });
          }
        });
      }
      break;
    case "job.completed":
      setState("jobStatus", "done");
      setState("jobProgress", 100);
      setState("isContinuation", false); // 续接完成
      push({ id: crypto.randomUUID(), role: "system", text: "任务完成", ts: Date.now() });
      loadJobs();
      break;
    case "job.failed":
      setState("jobStatus", "failed");
      setState("isContinuation", false);
      push({ id: crypto.randomUUID(), role: "system", text: `任务失败：${evt.error || ""}`, ts: Date.now() });
      loadJobs();
      break;
    case "blueprint.ready":
      // 页面规划已生成，等待用户确认
      if (evt.blueprint) {
        setPendingBlueprint(evt.blueprint as PageBlueprint);
      }
      break;
    case "visual_sample.ready":
      // 视觉样本已生成，等待用户确认
      if (evt.visualSample) {
        setPendingVisualSample(evt.visualSample as VisualSamplePackage);
      }
      break;
  }
}
