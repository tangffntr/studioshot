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
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);

  onMount(() => { connectSSE(); loadJobs(); setInterval(loadJobs, 10000); });

  const openJob = async (jobId: string) => { await loadJobConversation(jobId); navigate("/"); };

  const deleteJob = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      setConfirmDelete(null);
      await loadJobs(); // 重新加载任务列表
    } catch (e) {
      console.error("删除任务失败", e);
    }
  };

  const handleNewConversation = () => {
    newConversation();
    navigate("/");
  };

  return (
    <div class="app-layout">
      {/* 左侧菜单栏 */}
      <aside class={`sidebar ${collapsed() ? "collapsed" : ""}`}>
        <div class="sidebar-header">
          <div class="sidebar-logo">Studio<span class="dot">.</span>Shot</div>
        </div>
        <button class="new-chat-btn" onClick={handleNewConversation}>
          + 新建对话
        </button>
        <nav class="nav-list">
          <A href="/" class="nav-item" activeClass="active" end>
            <span class="nav-icon">💬</span> 聊天
          </A>
          <A href="/history" class="nav-item" activeClass="active">
            <span class="nav-icon">📋</span> 历史记录
          </A>
          <A href="/materials" class="nav-item" activeClass="active">
            <span class="nav-icon">⭐</span> 素材库
          </A>
          <A href="/assets" class="nav-item" activeClass="active">
            <span class="nav-icon">🖼️</span> 资产库
          </A>
          <A href="/canvas" class="nav-item" activeClass="active">
            <span class="nav-icon">🎨</span> 画布
          </A>
          <A href="/settings" class="nav-item" activeClass="active">
            <span class="nav-icon">⚙️</span> 模型设置
          </A>

          <div class="nav-section-label">最近任务</div>
          <For each={state.jobs.slice(0, 12)}>
            {(job: JobSummary) => (
              <div class="history-item" title={job.instruction}>
                <div class="history-item-content" onClick={() => openJob(job.id)}>
                  {job.instruction.slice(0, 26)}
                  <span class="h-status">· {job.status}</span>
                </div>
                <Show when={confirmDelete() === job.id} fallback={
                  <button
                    class="history-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(job.id);
                    }}
                    title="删除任务"
                  >
                    ✕
                  </button>
                }>
                  <div class="history-item-confirm" onClick={(e) => e.stopPropagation()}>
                    <button class="confirm-yes" onClick={() => deleteJob(job.id)}>✓</button>
                    <button class="confirm-no" onClick={() => setConfirmDelete(null)}>✕</button>
                  </div>
                </Show>
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

/** 右侧产出栏：可折叠 + 产出图 + prompt编辑 + 重生成 + 单击放大 */
function OutputPanel() {
  const [collapsed, setCollapsed] = createSignal(false);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);

  return (
    <aside class={`output-panel ${collapsed() ? "collapsed" : ""}`}>
      <div class="output-panel-header">
        <span class="font-mono" style={{ "font-size": "10px", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "var(--fg-mute)" }}>产出物</span>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span class="hint">{state.outputMedia.length} 项</span>
          <button class="collapse-btn" style={{ "font-size": "14px" }} onClick={() => setCollapsed(!collapsed())} title="折叠/展开">
            {collapsed() ? "◀" : "▶"}
          </button>
        </div>
      </div>
      <Show when={!collapsed()}>
        <For each={state.outputMedia}>{(m, i) => <OutputCard media={m} index={i()} onZoom={(url: string) => setLightboxUrl(url)} />}</For>
      </Show>
      <Show when={lightboxUrl()}>
        <div class="lightbox" onClick={() => setLightboxUrl(null)}>
          <Show when={lightboxUrl()!.endsWith(".mp4") || lightboxUrl()!.includes("/video/")} fallback={
            <img src={lightboxUrl()!} class="lightbox-img" alt="" />
          }>
            <video src={lightboxUrl()!} controls autoplay loop style={{ "max-width": "90vw", "max-height": "85vh", "border-radius": "8px" }} onClick={(e) => e.stopPropagation()} />
          </Show>
          <div class="lightbox-hint">点击任意处关闭</div>
        </div>
      </Show>
    </aside>
  );
}

function OutputCard(props: { media: any; index: number; onZoom: (url: string) => void }) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(props.media.promptText || "");
  const [regenerating, setRegenerating] = createSignal(false);
  const isVideo = () => props.media.url?.endsWith(".mp4") || props.media.url?.includes("/video/");

  const save = async () => {
    await fetch(`/api/media/${props.media.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptText: draft() }) });
    setEditing(false);
    setState("outputMedia", props.index, "promptText", draft());
  };

  const regenerate = async () => {
    const prompt = editing() ? draft() : (props.media.promptText || "");
    setRegenerating(true);
    try {
      if (editing()) await save();
      const job = await fetch("/api/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: prompt, mode: "agent" }),
      }).then((r) => r.json());
      setState("currentJobId", job.jobId);
      setState("jobStatus", "queued");
      setState("messages", (m) => [...m, { id: crypto.randomUUID(), role: "system" as const, text: `🔄 重生成中：${prompt.slice(0, 40)}...`, ts: Date.now() }]);
    } catch (e: any) {
      console.error("重生成失败", e);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div class="output-card">
      <Show when={isVideo()} fallback={
        <img src={props.media.url} class="output-card-img" alt="" onClick={() => props.onZoom(props.media.url)} />
      }>
        <video src={props.media.url} class="output-card-img" muted loop playsinline preload="metadata"
          onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
          onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          onClick={() => props.onZoom(props.media.url)}
        />
        <span class="video-badge" style={{ position: "absolute", top: "6px", right: "6px" }}>▶ 视频</span>
      </Show>
      <Show when={props.media.slotCode}><span class="slot-badge">{props.media.slotCode}</span></Show>
      <Show when={editing()} fallback={
        <div class="output-prompt" onClick={() => { setDraft(props.media.promptText || ""); setEditing(true); }}>
          {props.media.promptText || "(无 prompt)"}
        </div>
      }>
        <textarea class="output-prompt-edit" value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} rows={3} />
      </Show>
      <div style={{ display: "flex", gap: "6px", "margin-top": "6px" }}>
        <Show when={editing()}>
          <button class="btn btn-primary btn-sm" onClick={save}>保存</button>
          <button class="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>取消</button>
        </Show>
        <button class="btn btn-ghost btn-sm" onClick={regenerate} disabled={regenerating()} style={{ "margin-left": "auto" }} title="用此 prompt 重新生成">
          {regenerating() ? "⏳" : "🔄 重生成"}
        </button>
      </div>
    </div>
  );
}
