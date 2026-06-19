/**
 * web/src/context/store.ts — 全局状态（Solid createStore）
 * 管理 products / jobs / 事件流 / 当前 jobId，按 SSE 事件归约。
 * 照搬 opencode sync.tsx 的"事件→store 归约"模式。
 */
import { createStore } from "solid-js/store";
import type { SseEvent } from "@ecom/shared";

export interface TimelineItem {
  id: string;
  type: "user" | "agent" | "tool" | "media" | "system";
  text?: string;
  toolName?: string;
  mediaId?: string;
  mediaUrl?: string;
  ts: number;
}

interface AppState {
  currentJobId: string | null;
  jobStatus: string | null;
  jobProgress: number;
  timeline: TimelineItem[];
  mediaList: Array<{ id: string; url: string; promptText: string | null }>;
  connected: boolean;
}

const [state, setState] = createStore<AppState>({
  currentJobId: null,
  jobStatus: null,
  jobProgress: 0,
  timeline: [],
  mediaList: [],
  connected: false,
});

export { state, setState };

let evtSource: EventSource | null = null;

/** 连接 SSE（单一连接，所有事件都走这条） */
export function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource("/api/events");
  evtSource.onopen = () => setState("connected", true);
  evtSource.onerror = () => {
    setState("connected", false);
    // opencode 同款：3s 后自动重连
    setTimeout(() => connectSSE(), 3000);
  };
  evtSource.onmessage = (e) => {
    try {
      const evt: SseEvent = JSON.parse(e.data);
      handleEvent(evt);
    } catch {}
  };
}

/** 按 jobId 过滤并归约事件 */
function handleEvent(evt: SseEvent) {
  if (state.currentJobId && evt.jobId && evt.jobId !== state.currentJobId) return;
  const push = (item: TimelineItem) => setState("timeline", (t) => [...t, item]);

  switch (evt.type) {
    case "job.started":
      setState("jobStatus", "running");
      push({ id: crypto.randomUUID(), type: "system", text: "任务开始", ts: Date.now() });
      break;
    case "job.progress":
      setState("jobProgress", evt.progress || 0);
      if (evt.message) push({ id: crypto.randomUUID(), type: "system", text: evt.message, ts: Date.now() });
      break;
    case "agent.message":
      if (evt.text) push({ id: crypto.randomUUID(), type: "agent", text: evt.text, ts: Date.now() });
      break;
    case "tool.call":
      push({ id: crypto.randomUUID(), type: "tool", toolName: evt.toolName, text: `调用 ${evt.toolName}`, ts: Date.now() });
      break;
    case "tool.result":
      push({ id: crypto.randomUUID(), type: "tool", toolName: evt.toolName, text: `${evt.toolName} 完成`, ts: Date.now() });
      break;
    case "media.completed":
      // 拉取该 media 的 url（后端 /api/media）
      if (evt.mediaId) {
        fetch(`/api/media`).then((r) => r.json()).then((list: any[]) => {
          const m = list.find((x) => x.id === evt.mediaId);
          if (m) {
            setState("mediaList", (ml) => [...ml, { id: m.id, url: m.url, promptText: m.promptText }]);
            push({ id: crypto.randomUUID(), type: "media", mediaId: m.id, mediaUrl: m.url, ts: Date.now() });
          }
        });
      }
      break;
    case "job.completed":
      setState("jobStatus", "done");
      setState("jobProgress", 100);
      push({ id: crypto.randomUUID(), type: "system", text: "任务完成", ts: Date.now() });
      break;
    case "job.failed":
      setState("jobStatus", "failed");
      push({ id: crypto.randomUUID(), type: "system", text: `任务失败：${evt.error || ""}`, ts: Date.now() });
      break;
  }
}
