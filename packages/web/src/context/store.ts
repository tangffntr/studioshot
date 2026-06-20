/**
 * web/src/context/store.ts — 全局状态
 * 聊天消息流 + jobs 历史列表 + SSE 归约
 */
import { createStore } from "solid-js/store";
import type { SseEvent } from "@ecom/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool" | "media" | "system";
  text?: string;
  toolName?: string;
  mediaId?: string;
  mediaUrl?: string;
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
}

const [state, setState] = createStore<AppState>({
  currentJobId: null,
  jobStatus: null,
  jobProgress: 0,
  messages: [],
  outputMedia: [],
  jobs: [],
  connected: false,
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

/** 新建对话（清空当前消息） */
export function newConversation() {
  setState("currentJobId", null);
  setState("jobStatus", null);
  setState("jobProgress", 0);
  setState("messages", []);
  setState("outputMedia", []);
}

function push(msg: ChatMessage) { setState("messages", (m) => [...m, msg]); }

function handleEvent(evt: SseEvent) {
  if (state.currentJobId && evt.jobId && evt.jobId !== state.currentJobId) return;
  switch (evt.type) {
    case "job.started":
      setState("jobStatus", "running");
      push({ id: crypto.randomUUID(), role: "system", text: "任务开始", ts: Date.now() });
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
        // 查单图详情（含 promptText），增量填充 outputMedia + 消息流
        fetch(`/api/media/${evt.mediaId}`).then((r) => r.json()).then((m: any) => {
          if (m) {
            setState("outputMedia", (om) => [...om, { id: m.id, url: m.url, promptText: m.promptText, slotCode: m.slotCode, sortOrder: m.sortOrder }]);
            push({ id: crypto.randomUUID(), role: "media", mediaId: m.id, mediaUrl: m.url, slotCode: m.slotCode, promptText: m.promptText, ts: Date.now() });
          }
        });
      }
      break;
    case "job.completed":
      setState("jobStatus", "done");
      setState("jobProgress", 100);
      push({ id: crypto.randomUUID(), role: "system", text: "任务完成", ts: Date.now() });
      loadJobs();
      break;
    case "job.failed":
      setState("jobStatus", "failed");
      push({ id: crypto.randomUUID(), role: "system", text: `任务失败：${evt.error || ""}`, ts: Date.now() });
      loadJobs();
      break;
  }
}
