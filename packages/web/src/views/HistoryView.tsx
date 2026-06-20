/** web/src/views/HistoryView.tsx — 历史记录列表 */
import { For, Show, onMount } from "solid-js";
import { state, loadJobs, type JobSummary } from "../context/store";

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s前`;
  if (s < 3600) return `${Math.floor(s / 60)}m前`;
  if (s < 86400) return `${Math.floor(s / 3600)}h前`;
  return `${Math.floor(s / 86400)}d前`;
}

export default function HistoryView() {
  onMount(loadJobs);
  return (
    <div class="view-page">
      <h1 class="font-display">历史记录</h1>
      <Show when={state.jobs.length === 0}>
        <div style={{ color: "var(--fg-mute)", "text-align": "center", padding: "40px" }}>暂无任务记录</div>
      </Show>
      <For each={state.jobs}>{(job: JobSummary) => (
        <div class="history-list-item">
          <div class="hli-info">
            <div class="hli-title">{job.instruction.slice(0, 60)}</div>
            <div class="hli-meta">{job.productName || "未知产品"} · {job.type} · {timeAgo(job.createdAt)}</div>
          </div>
          <span class={`hli-status ${job.status}`}>{job.status}</span>
        </div>
      )}</For>
    </div>
  );
}
