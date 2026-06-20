/**
 * web/src/App.tsx — ChatGPT 式布局外壳
 * 左侧菜单栏 + 右侧主区（children 由 Router 注入）
 */
import { createSignal, onMount, Show, For } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { state, setState, connectSSE, loadJobs, loadJobConversation, newConversation, type JobSummary } from "./context/store";
import { toggleTheme } from "./context/theme";

export function AppLayout(props: { children?: any }) {
  const [collapsed, setCollapsed] = createSignal(false);
  const navigate = useNavigate();

  onMount(() => { connectSSE(); loadJobs(); setInterval(loadJobs, 10000); });

  const openJob = async (jobId: string) => { await loadJobConversation(jobId); navigate("/"); };

  return (
    <div class="app-layout">
      {/* 左侧菜单栏 */}
      <aside class={`sidebar ${collapsed() ? "collapsed" : ""}`}>
        <div class="sidebar-header">
          <div class="sidebar-logo">Studio<span class="dot">.</span>Shot</div>
        </div>
        <button class="new-chat-btn" onClick={() => { newConversation(); window.location.hash = "#/"; }}>
          + 新建出图
        </button>
        <nav class="nav-list">
          <A href="/" class="nav-item" activeClass="active" end>
            <span class="nav-icon">✦</span> 聊天
          </A>
          <A href="/history" class="nav-item" activeClass="active">
            <span class="nav-icon">◷</span> 历史记录
          </A>
          <A href="/materials" class="nav-item" activeClass="active">
            <span class="nav-icon">▦</span> 素材库
          </A>
          <A href="/assets" class="nav-item" activeClass="active">
            <span class="nav-icon">▣</span> 资产库
          </A>
          <A href="/settings" class="nav-item" activeClass="active">
            <span class="nav-icon">⚙</span> 模型设置
          </A>

          <div class="nav-section-label">最近任务</div>
          <For each={state.jobs.slice(0, 12)}>
            {(job: JobSummary) => (
              <div class="history-item" title={job.instruction} onClick={() => openJob(job.id)}>
                {job.instruction.slice(0, 26)}
                <span class="h-status">· {job.status}</span>
              </div>
            )}
          </For>
        </nav>
        <div class="sidebar-footer">
          <button class="theme-toggle" onClick={toggleTheme} title="切换主题">
            <Show when={document.documentElement.dataset.theme === "dark"} fallback="🌙">☀</Show>
          </button>
          <span class="status-pill">
            <span class={`status-dot ${state.connected ? "" : "off"}`}></span>
          </span>
        </div>
      </aside>

      {/* 主区：聊天 + 右侧产出栏 */}
      <div class="main-area">
        <div class="main-header">
          <button class="collapse-btn" onClick={() => setCollapsed(!collapsed())}>☰</button>
          <Show when={state.jobStatus}>
            <span class="mode-badge">{state.jobStatus} {state.jobProgress > 0 ? state.jobProgress.toFixed(0) + "%" : ""}</span>
          </Show>
        </div>
        <div class="main-content">
          <div class="chat-column">{props.children}</div>
          <Show when={state.outputMedia.length > 0}>
            <OutputPanel />
          </Show>
        </div>
      </div>
    </div>
  );
}

/** 右侧产出栏：当前 job 产出的图 + prompt（可编辑重生成） */
function OutputPanel() {
  return (
    <aside class="output-panel">
      <div class="output-panel-header">
        <span class="font-mono" style={{ "font-size": "10px", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "var(--fg-mute)" }}>产出物</span>
        <span class="hint">{state.outputMedia.length} 项</span>
      </div>
      <For each={state.outputMedia}>{(m, i) => <OutputCard media={m} index={i()} />}</For>
    </aside>
  );
}

function OutputCard(props: { media: any; index: number }) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(props.media.promptText || "");

  const save = async () => {
    await fetch(`/api/media/${props.media.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptText: draft() }) });
    setEditing(false);
    setState("outputMedia", props.index, "promptText", draft());
  };

  return (
    <div class="output-card">
      <img src={props.media.url} class="output-card-img" alt="" />
      <Show when={props.media.slotCode}><span class="slot-badge">{props.media.slotCode}</span></Show>
      <Show when={editing()} fallback={
        <div class="output-prompt" onClick={() => { setDraft(props.media.promptText || ""); setEditing(true); }}>
          {props.media.promptText || "(无 prompt)"}
        </div>
      }>
        <textarea class="output-prompt-edit" value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} rows={3} />
        <div style={{ display: "flex", gap: "6px", "margin-top": "4px" }}>
          <button class="btn btn-primary btn-sm" onClick={save}>保存</button>
          <button class="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>取消</button>
        </div>
      </Show>
    </div>
  );
}
