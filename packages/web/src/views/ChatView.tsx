/**
 * web/src/views/ChatView.tsx — 聊天视图
 * 加号上传 + 平台选择 + 多图模式 + 双击看大图 + 页面规划确认 + 自动滚动
 */
import { createSignal, Show, For, createEffect } from "solid-js";
import { state, setState } from "../context/store";
import type { ChatMessage } from "../context/store";
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
  // 素材库选择
  const [materials, setMaterials] = createSignal<Array<any>>([]);
  const [showMaterials, setShowMaterials] = createSignal(false);
  const [selMaterial, setSelMaterial] = createSignal<any | null>(null);
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
    setSelMaterial(m);
    setShowMaterials(false);
    // 不填入输入框，发送时自动拼接
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
    // 选了素材时，把素材 prompt 拼接到指令前
    if (selMaterial()?.promptText) {
      const matPrompt = selMaterial().promptText;
      instruction = instruction ? `${matPrompt}\n\n用户补充要求：${instruction}` : matPrompt;
    }
    if (!instruction && !productImg() && !selAsset()) return;
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
        // 如果选择了素材，添加素材的 sourceMediaId
        if (selMaterial()?.sourceMediaId) {
          if (!continueBody.attachments) continueBody.attachments = [];
          continueBody.attachments.push(selMaterial().sourceMediaId);
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
        if (selMaterial()?.sourceMediaId) {
          if (!jobBody.attachments) jobBody.attachments = [];
          jobBody.attachments.push(selMaterial().sourceMediaId);
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

      setText(""); setProductImg(null); setImgName("");
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
              <div class="msg-avatar tl-agent">AI</div>
              <div class="msg-content agent">
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
            <textarea ref={textareaEl} value={text()} onInput={(e) => { setText(e.currentTarget.value); autoResize(e.currentTarget); }} onKeyDown={onKeyDown}
              placeholder={selMaterial() ? `素材已选: ${selMaterial().name}，输入补充要求或直接发送` : selAsset() ? `资产已选: ${(selAsset().slotCode || "图片").slice(0, 15)}... 描述需求或直接发送` : imgName() ? `已选: ${imgName().slice(0, 20)}... 描述需求或直接发送` : "描述你想要的图片..."} rows={2} />
            <div class="input-bottom">
              <div class="input-left-actions">
                <button class="input-action-btn" onClick={() => fileInput?.click()} title="上传产品图">
                  ＋
                </button>
                <input ref={fileInput} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
                <button class="input-action-btn" onClick={() => { loadMaterials(); setShowMaterials(true); }} title="选择素材">
                  ⭐
                </button>
                <button class="input-action-btn" onClick={() => { loadAssets(); setShowAssets(true); }} title="选择资产库图片">
                  🖼️
                </button>
              </div>
              <button class="send-btn" onClick={send} disabled={busy() || (!text().trim() && !productImg() && !selAsset())}>
                🚀
              </button>
            </div>
          </div>
          <Show when={error()}><div class="error-msg">{error()}</div></Show>
        </div>
      </div>

      {/* 素材选择弹窗 */}
      <Show when={showMaterials()}>
        <div class="lightbox" onClick={() => setShowMaterials(false)}>
          <div class="material-picker" onClick={(e) => e.stopPropagation()}>
            <div class="font-display" style={{ "font-size": "16px", "margin-bottom": "12px" }}>选择素材</div>
            <Show when={materials().length === 0}>
              <div class="hint">暂无素材。在资产库中「存为素材」添加。</div>
            </Show>
            <div class="material-picker-grid">
              <For each={materials()}>{(m) => (
                <div class="material-pick-item" onClick={() => pickMaterial(m)}>
                  <img src={m.url} alt={m.name} />
                  <div class="hint" style={{ "font-size": "10px", "text-align": "center" }}>{m.name}</div>
                </div>
              )}</For>
            </div>
            <button class="btn btn-ghost btn-sm" style={{ "margin-top": "10px" }} onClick={() => setShowMaterials(false)}>关闭</button>
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

function MessageRow(props: { msg: ChatMessage }) {
  if (props.msg.role === "user") {
    return <div class="msg-user"><div class="bubble">{props.msg.text}</div></div>;
  }
  const cls = () => ({ user: "tl-system", agent: "tl-agent", tool: "tl-tool", media: "tl-media", system: "tl-system" }[props.msg.role] || "tl-system");
  const icon = () => ({ user: "你", agent: "AI", tool: "⚙", media: "◉", system: "·" }[props.msg.role] || "·");
  const isVideo = () => props.msg.mediaType === "video" || props.msg.mediaUrl?.endsWith(".mp4");
  return (
    <div class="msg-row">
      <div class={`msg-avatar ${cls()}`}>{icon()}</div>
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
