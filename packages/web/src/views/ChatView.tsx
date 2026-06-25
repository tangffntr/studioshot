/**
 * web/src/views/ChatView.tsx — 聊天视图
 * 加号上传 + 平台选择 + 多图模式 + 双击看大图 + 页面规划确认 + 自动滚动
 */
import { createSignal, Show, For, createEffect } from "solid-js";
import { state, setState } from "../context/store";
import type { ChatMessage } from "../context/store";
import { TOOL_LABEL } from "../context/store";
import BlueprintConfirm from "./BlueprintConfirm";

const MODES = [
  { key: "agent", label: "单图" },
  { key: "template", label: "套图" },
  { key: "video", label: "视频" },
];

const PLATFORMS = [
  { key: "", label: "通用" },
  { key: "taobao", label: "淘宝" },
  { key: "jd", label: "京东" },
  { key: "douyin", label: "抖音" },
  { key: "pdd", label: "拼多多" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const r = reader.result as string; const c = r.indexOf(","); resolve(c > 0 ? r.slice(c + 1) : r); };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

export default function ChatView() {
  const [mode, setMode] = createSignal("agent");
  const [platform, setPlatform] = createSignal("");
  const [text, setText] = createSignal("");
  const [productImg, setProductImg] = createSignal<File | null>(null);
  const [imgName, setImgName] = createSignal("");
  const [imgPreview, setImgPreview] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  // 素材库选择（多选）
  const [materials, setMaterials] = createSignal<Array<any>>([]);
  const [showMaterials, setShowMaterials] = createSignal(false);
  const [selMaterials, setSelMaterials] = createSignal<Array<any>>([]);
  // 弹窗内临时选中（多选，确定后才提交到 selMaterials）
  const [pendingMaterials, setPendingMaterials] = createSignal<Array<any>>([]);
  // 资产库选择
  const [assets, setAssets] = createSignal<Array<any>>([]);
  const [showAssets, setShowAssets] = createSignal(false);
  const [selAsset, setSelAsset] = createSignal<any | null>(null);
  let fileInput: HTMLInputElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;
  let chatStreamEl: HTMLDivElement | undefined;

  // 自动滚动到底部（新消息到达时）
  const scrollToBottom = () => {
    if (chatStreamEl) {
      requestAnimationFrame(() => {
        chatStreamEl!.scrollTop = chatStreamEl!.scrollHeight;
      });
    }
  };

  // 监听消息变化，自动滚动
  createEffect(() => {
    // 读取 messages 长度，触发响应式更新
    void state.messages.length;
    scrollToBottom();
  });

  // 监听 jobProgress 变化，自动滚动
  createEffect(() => {
    void state.jobProgress;
    scrollToBottom();
  });

  const loadMaterials = async () => { try { setMaterials(await fetch("/api/materials").then(r => r.json())); } catch {} };
  const loadAssets = async () => {
    try {
      const all = await fetch("/api/media").then(r => r.json());
      // 只显示图片类型的资产，按创建时间倒序
      const imageAssets = all.filter((m: any) => m.type === "image").sort((a: any, b: any) => b.createdAt - a.createdAt);
      setAssets(imageAssets);
    } catch {}
  };

  const pickMaterial = (m: any) => {
    // 多选 toggle：已选则移除，未选则加入
    setPendingMaterials((cur) => {
      const exists = cur.find((x) => x.id === m.id);
      return exists ? cur.filter((x) => x.id !== m.id) : [...cur, m];
    });
  };

  const openMaterialPicker = () => {
    loadMaterials();
    // 打开时用当前已确认的选中初始化临时态
    setPendingMaterials([...selMaterials()]);
    setShowMaterials(true);
  };

  const confirmMaterials = () => {
    setSelMaterials([...pendingMaterials()]);
    setShowMaterials(false);
  };

  const pickAsset = (a: any) => {
    setSelAsset(a);
    setShowAssets(false);
    // 设置为产品图
    setImgName(a.slotCode || "资产图片");
    setImgPreview(a.url);
    // 清除文件选择（因为使用的是资产库图片）
    setProductImg(null);
    if (fileInput) fileInput.value = "";
  };

  const onFile = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) {
      setProductImg(f);
      setImgName(f.name);
      // 生成预览URL
      const reader = new FileReader();
      reader.onload = () => setImgPreview(reader.result as string);
      reader.readAsDataURL(f);
    }
  };

  const removeProductImg = () => {
    setProductImg(null);
    setImgName("");
    setImgPreview(null);
    if (fileInput) fileInput.value = "";
  };

  // 把选中的多个素材转为 attachment id 列表（作为参考图传给后端）
  // sourceMediaId 优先（指向 media 表），否则用素材自身 id（后端从 materials 表读图）
  const materialAttachmentIds = (): string[] => {
    return selMaterials()
      .filter((m) => m.filePath || m.sourceMediaId) // 仅有图的素材才作参考
      .map((m) => m.sourceMediaId || m.id);
  };

  const removeSelMaterial = (id: string) => {
    setSelMaterials((cur) => cur.filter((m) => m.id !== id));
  };

  // textarea 自适应高度
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const send = async () => {
    if (!text().trim() && !productImg()) return;
    setError("");
    setBusy(true);

    // 构建增强指令：用户输入 + 素材 prompt + 平台约束
    let instruction = text() || "";
    // 选了多个素材时，把素材 prompt 拼接到指令前（作为辅助说明，参考图在 attachments 里传）
    const matPrompts = selMaterials().map((m) => m.promptText).filter(Boolean);
    if (matPrompts.length > 0) {
      const matPrompt = matPrompts.join("\n");
      instruction = instruction ? `${matPrompt}\n\n用户补充要求：${instruction}` : matPrompt;
    }
    if (!instruction && !productImg() && !selAsset() && selMaterials().length === 0) return;
    if (!instruction) instruction = "生成图片";
    if (platform()) {
      const rules: Record<string, string> = {
        taobao: "（淘宝规格：800x800白底主图，750px宽详情页，风格多样化）",
        jd: "（京东规格：800x800纯白底强制，冷调专业风格）",
        douyin: "（抖音规格：800x800实物图，暖调生活化，短视频风格）",
        pdd: "（拼多多规格：750x750纯白底，高对比度，突出性价比）",
      };
      instruction += ` ${rules[platform()] || ""}`;
    }

    setState("messages", (m) => [...m, { id: crypto.randomUUID(), role: "user", text: text() || `[${mode()}] 出图请求`, ts: Date.now() }]);

    // ⭐ 续接模式：当前有已完成的 job 时，使用续接端点
    const shouldContinue = state.currentJobId && state.jobStatus === "done";

    try {
      if (shouldContinue) {
        // 续接对话：在同一个 job 上继续
        setState("isContinuation", true);
        const continueBody: any = { instruction };

        // 如果上传了新产品图，使用新产品图
        if (productImg()) {
          const b64 = await fileToBase64(productImg()!);
          const up = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: imgName(), imageBase64: b64, imageMime: "image/png" }) }).then((r) => r.json());
          continueBody.attachments = [up.mediaId];
        }
        // 如果选择了资产库图片，使用资产库的mediaId
        if (selAsset()) {
          if (!continueBody.attachments) continueBody.attachments = [];
          continueBody.attachments.push(selAsset().id);
        }
        // 如果选择了素材（多个），把素材图作为参考图加入 attachments
        const matIds = materialAttachmentIds();
        if (matIds.length > 0) {
          if (!continueBody.attachments) continueBody.attachments = [];
          continueBody.attachments.push(...matIds);
        }

        // ⭐ 如果没有新的 attachment，使用上次生成的产品图
        // 后端会自动从 lastGeneratedMediaId 获取
        if (!continueBody.attachments || continueBody.attachments.length === 0) {
          // 标记需要使用上次生成的图
          continueBody.useLastGenerated = true;
        }

        // ⭐ 传递当前选择的模式和平台（用于套图模式）
        if (mode() === "template") {
          // 根据平台选择对应的模板ID
          const templateMap: Record<string, string> = {
            "": "builtin-amazon-pdp",      // 通用默认使用亚马逊模板
            "taobao": "builtin-taobao-pdp",
            "jd": "builtin-jd-pdp",
            "douyin": "builtin-douyin-pdp",
            "pdd": "builtin-pdd-pdp",
          };
          continueBody.templateId = templateMap[platform()] || "builtin-amazon-pdp";
        } else {
          continueBody.mode = mode() === "agent" ? "agent" : mode();
        }

        await fetch(`/api/jobs/${state.currentJobId}/continue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(continueBody),
        });
        // 不改变 currentJobId，继续使用原 job
        setState("jobStatus", "queued");
      } else {
        // 新对话模式
        setState("isContinuation", false);
        setState("outputMedia", []);
        const jobBody: any = { instruction };
        if (productImg()) {
          const b64 = await fileToBase64(productImg()!);
          const up = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: imgName(), imageBase64: b64, imageMime: "image/png" }) }).then((r) => r.json());
          jobBody.productId = up.productId;
          jobBody.attachments = [up.mediaId];
        }
        // 如果选择了资产库图片，使用资产库的mediaId
        if (selAsset()) {
          if (!jobBody.attachments) jobBody.attachments = [];
          jobBody.attachments.push(selAsset().id);
        }
        // 如果选择了素材（多个），把素材图作为参考图加入 attachments
        const matIds = materialAttachmentIds();
        if (matIds.length > 0) {
          if (!jobBody.attachments) jobBody.attachments = [];
          jobBody.attachments.push(...matIds);
        }
        if (mode() === "template") {
          // 根据平台选择对应的模板ID
          const templateMap: Record<string, string> = {
            "": "builtin-amazon-pdp",      // 通用默认使用亚马逊模板
            "taobao": "builtin-taobao-pdp",
            "jd": "builtin-jd-pdp",
            "douyin": "builtin-douyin-pdp",
            "pdd": "builtin-pdd-pdp",
          };
          jobBody.templateId = templateMap[platform()] || "builtin-amazon-pdp";
        }
        else jobBody.mode = mode() === "agent" ? "agent" : mode();

        const result = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobBody) }).then((r) => r.json());
        setState("currentJobId", result.jobId);
        setState("jobStatus", "queued");
      }

      setText(""); setProductImg(null); setImgName(""); setSelMaterials([]); setSelAsset(null); setImgPreview(null);
    } catch (e: any) {
      setError(e.message || "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  const isEmptyChat = () => state.messages.length === 0 && state.confirmationStatus === "none";

  return (
    <div class={`chat-container ${isEmptyChat() ? "empty" : ""}`}>
      <div class="chat-stream" ref={chatStreamEl}>
        <div class="chat-inner">
          <Show when={state.messages.length === 0}>
            <div class="welcome-screen">
              <div class="welcome-icon">✦</div>
              <div class="welcome-title font-display">Studio.Shot</div>
              <div class="welcome-desc">选择平台，描述需求，或点击 ＋ 上传产品图</div>
            </div>
          </Show>
          <For each={state.messages}>{(msg: ChatMessage) => <MessageRow msg={msg} />}</For>
          {/* 任务进度指示器 */}
          <Show when={state.jobStatus === "running" || state.jobStatus === "queued"}>
            <div class="msg-row">
              <div class="msg-avatar tl-agent" title="AI">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a3 3 0 013 3v1h2a3 3 0 013 3v2.5a2 2 0 010 4V19a3 3 0 01-3 3H7a3 3 0 01-3-3v-3.5a2 2 0 010-4V9a3 3 0 013-3h2V5a3 3 0 013-3zm-2 11a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>
              </div>
              <div class="msg-content agent">
                <ToolStepsPanel />
                <div class="thinking-indicator">
                  <span class="thinking-dot">●</span>
                  <span class="thinking-dot">●</span>
                  <span class="thinking-dot">●</span>
                  <span class="thinking-text">
                    {state.jobStatus === "queued" ? "排队中..." : state.jobProgress > 0 ? `生成中 ${state.jobProgress.toFixed(0)}%` : "思考中..."}
                  </span>
                </div>
              </div>
            </div>
          </Show>
          {/* 页面规划确认 */}
          <Show when={state.confirmationStatus === "blueprint_pending"}>
            <BlueprintConfirm />
          </Show>
        </div>
      </div>

      <div class="chat-input-area">
        <div class="chat-input-inner">
          <div class="mode-selector">
            <For each={PLATFORMS}>{(p) => (
              <span class={`mode-chip ${platform() === p.key ? "active" : ""}`} onClick={() => setPlatform(p.key)}>{p.label}</span>
            )}</For>
            <span style={{ width: "1px", height: "14px", background: "var(--border)", margin: "0 4px" }}></span>
            <For each={MODES}>{(m) => (
              <span class={`mode-chip ${mode() === m.key ? "active" : ""}`} onClick={() => setMode(m.key)}>{m.label}</span>
            )}</For>
          </div>
          <div class="input-box">
            <Show when={imgPreview()}>
              <div class="input-preview">
                <img src={imgPreview()!} alt={imgName()} />
                <button class="input-preview-delete" onClick={removeProductImg}>✕</button>
              </div>
            </Show>
            {/* 已选素材多图预览条（区别于产品图单预览槽） */}
            <Show when={selMaterials().length > 0}>
              <div class="input-materials-preview">
                <For each={selMaterials()}>
                  {(m) => (
                    <div class="input-material-chip" title={m.name}>
                      <img src={m.url} alt={m.name} />
                      <button class="input-preview-delete" onClick={() => removeSelMaterial(m.id)}>✕</button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <textarea ref={textareaEl} value={text()} onInput={(e) => { setText(e.currentTarget.value); autoResize(e.currentTarget); }} onKeyDown={onKeyDown}
              placeholder={selMaterials().length > 0 ? `已选 ${selMaterials().length} 个素材，输入融合要求或直接发送` : selAsset() ? `资产已选: ${(selAsset().slotCode || "图片").slice(0, 15)}... 描述需求或直接发送` : imgName() ? `已选: ${imgName().slice(0, 20)}... 描述需求或直接发送` : "描述你想要的图片..."} rows={2} />
            <div class="input-bottom">
              <div class="input-left-actions">
                <button class="input-action-btn" onClick={() => fileInput?.click()} title="上传产品图">
                  ＋
                </button>
                <input ref={fileInput} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
                <button class="input-action-btn" onClick={openMaterialPicker} title="选择素材（可多选，作为参考图）">
                  ⭐
                </button>
                <button class="input-action-btn" onClick={() => { loadAssets(); setShowAssets(true); }} title="选择资产库图片">
                  🖼️
                </button>
              </div>
              <button class="send-btn" onClick={send} disabled={busy() || (!text().trim() && !productImg() && !selAsset() && selMaterials().length === 0)}>
                🚀
              </button>
            </div>
          </div>
          <Show when={error()}><div class="error-msg">{error()}</div></Show>
        </div>
      </div>

      {/* 素材选择弹窗（多选） */}
      <Show when={showMaterials()}>
        <div class="lightbox" onClick={() => setShowMaterials(false)}>
          <div class="material-picker" onClick={(e) => e.stopPropagation()}>
            <div class="font-display" style={{ "font-size": "16px", "margin-bottom": "12px", display: "flex", "justify-content": "space-between", "align-items": "center" }}>
              <span>选择素材（可多选，作为参考图融合）</span>
              <span class="hint" style={{ "font-size": "12px" }}>已选 {pendingMaterials().length} 个</span>
            </div>
            <Show when={materials().length === 0}>
              <div class="hint">暂无素材。在资产库中「存为素材」添加。</div>
            </Show>
            <div class="material-picker-grid">
              <For each={materials()}>{(m) => {
                const selected = () => !!pendingMaterials().find((x) => x.id === m.id);
                return (
                  <div class={`material-pick-item ${selected() ? "selected" : ""}`} onClick={() => pickMaterial(m)}>
                    <img src={m.url} alt={m.name} />
                    <Show when={selected()}><span class="material-pick-check">✓</span></Show>
                    <div class="hint" style={{ "font-size": "10px", "text-align": "center" }}>{m.name}</div>
                  </div>
                );
              }}</For>
            </div>
            <div style={{ "margin-top": "10px", display: "flex", "gap": "8px", "justify-content": "flex-end" }}>
              <button class="btn btn-ghost btn-sm" onClick={() => setShowMaterials(false)}>取消</button>
              <button class="btn btn-sm" onClick={confirmMaterials}>确定（{pendingMaterials().length}）</button>
            </div>
          </div>
        </div>
      </Show>

      {/* 资产库选择弹窗 */}
      <Show when={showAssets()}>
        <div class="lightbox" onClick={() => setShowAssets(false)}>
          <div class="material-picker" onClick={(e) => e.stopPropagation()} style={{ "max-width": "700px" }}>
            <div class="font-display" style={{ "font-size": "16px", "margin-bottom": "12px" }}>选择资产库图片</div>
            <Show when={assets().length === 0}>
              <div class="hint">暂无资产。生成图片后会自动添加到资产库。</div>
            </Show>
            <div class="material-picker-grid" style={{ "grid-template-columns": "repeat(3, 1fr)" }}>
              <For each={assets().slice(0, 30)}>{(a: any) => (
                <div class="material-pick-item" onClick={() => pickAsset(a)}>
                  <img src={a.url} alt={a.slotCode || "资产"} />
                  <div class="hint" style={{ "font-size": "10px", "text-align": "center" }}>
                    {a.slotCode || "图片"} {a.promptText ? `· ${a.promptText.slice(0, 15)}...` : ""}
                  </div>
                </div>
              )}</For>
            </div>
            <button class="btn btn-ghost btn-sm" style={{ "margin-top": "10px" }} onClick={() => setShowAssets(false)}>关闭</button>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** 工具调用步骤面板（可折叠）。展示当前任务的工具调用过程。 */
function ToolStepsPanel() {
  const [expanded, setExpanded] = createSignal(false);
  const steps = () => state.toolSteps;
  const hasSteps = () => steps().length > 0;
  // 摘要：最后一步状态
  const summary = () => {
    const s = steps();
    if (s.length === 0) return "";
    const last = s[s.length - 1];
    const label = TOOL_LABEL[last.toolName] || last.toolName;
    if (last.status === "running") return `${label}…`;
    if (last.status === "failed") return `${label} 失败`;
    return `${label} ✓`;
  };
  const runningCount = () => steps().filter((s) => s.status === "running").length;
  // 任务完成或无运行中步骤时自动折叠
  createEffect(() => {
    if (state.jobStatus === "done" && runningCount() === 0) setExpanded(false);
  });

  return (
    <Show when={hasSteps()}>
      <div class="tool-steps-panel">
        <div class="tool-steps-header" onClick={() => setExpanded(!expanded())}>
          <span class="tool-steps-toggle">{expanded() ? "▾" : "▸"}</span>
          <span class="tool-steps-title">工具调用 · {steps().length} 步</span>
          <span class="tool-steps-summary">{summary()}</span>
        </div>
        <Show when={expanded()}>
          <div class="tool-steps-list">
            <For each={steps()}>{(step, i) => (
              <div class={`tool-step-item ${step.status}`}>
                <span class="tool-step-idx">{i() + 1}</span>
                <span class="tool-step-name">{TOOL_LABEL[step.toolName] || step.toolName}</span>
                <Show when={step.input}><span class="tool-step-input">{step.input}</span></Show>
                <span class="tool-step-status">
                  {step.status === "running" ? "…" : step.status === "failed" ? "✗" : "✓"}
                </span>
              </div>
            )}</For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function MessageRow(props: { msg: ChatMessage }) {
  if (props.msg.role === "user") {
    return (
      <div class="msg-user">
        <div class="bubble">{props.msg.text}</div>
        <div class="msg-avatar tl-user" title="你">
          {/* 用户头像：人物 SVG 图标 */}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"/></svg>
        </div>
      </div>
    );
  }
  const cls = () => ({ user: "tl-system", agent: "tl-agent", tool: "tl-tool", media: "tl-media", system: "tl-system" }[props.msg.role] || "tl-system");
  const isVideo = () => props.msg.mediaType === "video" || props.msg.mediaUrl?.endsWith(".mp4");
  // 头像图标（按角色）
  const avatarIcon = () => {
    if (props.msg.role === "agent") {
      return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a3 3 0 013 3v1h2a3 3 0 013 3v2.5a2 2 0 010 4V19a3 3 0 01-3 3H7a3 3 0 01-3-3v-3.5a2 2 0 010-4V9a3 3 0 013-3h2V5a3 3 0 013-3zm-2 11a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z"/></svg>;
    }
    if (props.msg.role === "tool") {
      return <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 8a4 4 0 014 4l2.5-1.5 1 1.7L17 14l2.5 1.8-1 1.7L16 16a4 4 0 01-8 0l-2.5 1.5-1-1.7L7 14l-2.5-1.8 1-1.7L8 12a4 4 0 014-4zm0 2a2 2 0 100 4 2 2 0 000-4z"/></svg>;
    }
    if (props.msg.role === "media") {
      return <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M21 5a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h18zm-4 4l-4 4-3-3-4 5h14l-3-6z"/></svg>;
    }
    return <span>·</span>; // system
  };
  return (
    <div class="msg-row">
      <div class={`msg-avatar ${cls()}`}>{avatarIcon()}</div>
      <div class={`msg-content ${props.msg.role === "agent" ? "agent" : ""}`}>
        {props.msg.text}
        <Show when={props.msg.mediaUrl}>
          <div>
            <Show when={isVideo()} fallback={
              <img class="msg-img" src={props.msg.mediaUrl} alt="" />
            }>
              <video class="msg-video" src={props.msg.mediaUrl} controls muted loop playsinline preload="metadata" />
            </Show>
            <Show when={props.msg.slotCode}><span class="slot-badge" style={{ "margin-left": "6px" }}>{props.msg.slotCode}</span></Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
