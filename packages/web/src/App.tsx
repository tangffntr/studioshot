/**
 * web/src/App.tsx — ChatGPT 式布局外壳
 * 左侧菜单栏 + 右侧主区（children 由 Router 注入）
 */
import { createSignal, onMount, Show, For } from "solid-js";
import { A } from "@solidjs/router";
import { state, connectSSE, loadJobs, newConversation, type JobSummary } from "./context/store";
import { toggleTheme } from "./context/theme";

export function AppLayout(props: { children?: any }) {
  const [collapsed, setCollapsed] = createSignal(false);

  onMount(() => { connectSSE(); loadJobs(); setInterval(loadJobs, 10000); });

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
          <A href="/assets" class="nav-item" activeClass="active">
            <span class="nav-icon">▣</span> 资产库
          </A>
          <A href="/settings" class="nav-item" activeClass="active">
            <span class="nav-icon">⚙</span> 模型设置
          </A>

          <div class="nav-section-label">最近任务</div>
          <For each={state.jobs.slice(0, 12)}>
            {(job: JobSummary) => (
              <div class="history-item" title={job.instruction}>
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

      {/* 右侧主区 */}
      <div class="main-area">
        <div class="main-header">
          <button class="collapse-btn" onClick={() => setCollapsed(!collapsed())}>☰</button>
          <Show when={state.jobStatus}>
            <span class="mode-badge">{state.jobStatus} {state.jobProgress > 0 ? state.jobProgress.toFixed(0) + "%" : ""}</span>
          </Show>
        </div>
        {props.children}
      </div>
    </div>
  );
}
