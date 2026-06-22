/**
 * web/src/views/ChatView.tsx — 聊天视图
 * 加号上传 + 平台选择 + 多图模式 + 双击看大图
 */
import { createSignal, Show, For } from "solid-js";
import { state, setState } from "../context/store";
import type { ChatMessage } from "../context/store";

const MODES = [
  { key: "agent", label: "单图" },
  { key: "template", label: "套图" },
  { key: "scene-swap", label: "场景替换" },
  { key: "tryon", label: "试穿" },
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
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [mergedOutput, setMergedOutput] = createSignal(false);
  const [lightbox, setLightbox] = createSignal<string | null>(null);
  // 素材库选择
  const [materials, setMaterials] = createSignal<Array<any>>([]);
  const [showMaterials, setShowMaterials] = createSignal(false);
  const [selMaterial, setSelMaterial] = createSignal<any | null>(null);
  let fileInput: HTMLInputElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;

  const loadMaterials = async () => { try { setMaterials(await fetch("/api/materials").then(r => r.json())); } catch {} };

  const pickMaterial = (m: any) => {
    setSelMaterial(m);
    setShowMaterials(false);
    // 不填入输入框，发送时自动拼接
  };

  const onFile = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) { setProductImg(f); setImgName(f.name); }
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

    // 构建增强指令：用户输入 + 素材 prompt 自动拼接
    let instruction = text() || "";
    // 选了素材时，把素材 prompt 拼接到指令前（用户输入为主，素材为辅）
    if (selMaterial()?.promptText) {
      const matPrompt = selMaterial().promptText;
      instruction = instruction ? `${matPrompt}\n\n用户补充要求：${instruction}` : matPrompt;
    }
    if (!instruction && !productImg()) return;
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
    if (mergedOutput()) instruction += " 请将多张详情页子图合并到一张大图中展示（节约生图次数）";

    setState("messages", (m) => [...m, { id: crypto.randomUUID(), role: "user", text: text() || `[${mode()}] 出图请求`, ts: Date.now() }]);
    setState("outputMedia", []);

    try {
      const jobBody: any = { instruction };
      if (productImg()) {
        const b64 = await fileToBase64(productImg()!);
        const up = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: imgName(), imageBase64: b64, imageMime: "image/png" }) }).then((r) => r.json());
        jobBody.productId = up.productId;
        jobBody.attachments = [up.mediaId];
      }
      // 素材参考图（选了素材时，其 sourceMediaId 作为额外参考）
      if (selMaterial()?.sourceMediaId) {
        if (!jobBody.attachments) jobBody.attachments = [];
        jobBody.attachments.push(selMaterial().sourceMediaId);
      }
      if (mode() === "template") jobBody.templateId = "builtin-amazon-pdp";
      else jobBody.mode = mode() === "agent" ? "agent" : mode();

      const job = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobBody) }).then((r) => r.json());
      setState("currentJobId", job.jobId);
      setState("jobStatus", "queued");
      setText(""); setProductImg(null); setImgName("");
    } catch (e: any) {
      setError(e.message || "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", flex: 1 }}>
      <div class="chat-stream">
        <div class="chat-inner">
          <Show when={state.messages.length === 0}>
            <div style={{ "text-align": "center", color: "var(--fg-mute)", padding: "60px 0" }}>
              <div style={{ "font-size": "36px", "margin-bottom": "12px", opacity: 0.3 }}>✦</div>
              <div class="font-display" style={{ "font-size": "20px", "margin-bottom": "6px" }}>Studio.Shot</div>
              <div style={{ "font-size": "13px" }}>选择平台，描述需求，或点击 ＋ 上传产品图</div>
            </div>
          </Show>
          <For each={state.messages}>{(msg: ChatMessage) => <MessageRow msg={msg} onImageClick={(url) => setLightbox(url)} />}</For>
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
            <Show when={mode() === "template" || mode() === "agent"}>
              <label class="mode-chip" style={{ cursor: "pointer", display: "inline-flex", "align-items": "center", gap: "3px" }}>
                <input type="checkbox" checked={mergedOutput()} onChange={(e) => setMergedOutput(e.currentTarget.checked)} style={{ width: "12px", height: "12px" }} />
                多图合一
              </label>
            </Show>
          </div>
          <div class="input-row">
            <button class="upload-plus-btn" onClick={() => fileInput?.click()} title="上传产品图（可选）">
              {imgName() ? "📎" : "＋"}
            </button>
            <input ref={fileInput} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
            <button class="upload-plus-btn" onClick={() => { loadMaterials(); setShowMaterials(true); }} title="选择素材">
              {selMaterial() ? "★" : "▦"}
            </button>
            <textarea ref={textareaEl} value={text()} onInput={(e) => { setText(e.currentTarget.value); autoResize(e.currentTarget); }} onKeyDown={onKeyDown}
              placeholder={selMaterial() ? `素材已选: ${selMaterial().name}，输入补充要求或直接发送` : imgName() ? `已选: ${imgName().slice(0, 20)}... 描述需求或直接发送` : "描述你想要的图片，或点击 ＋ 上传产品图..."} rows={2} />
            <button class="send-btn" onClick={send} disabled={busy() || (!text().trim() && !productImg())}>↑</button>
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

      {/* 双击大图 lightbox */}
      <Show when={lightbox()}>
        <div class="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox()!} class="lightbox-img" alt="" />
          <div class="lightbox-hint">点击任意处关闭</div>
        </div>
      </Show>
    </div>
  );
}

function MessageRow(props: { msg: ChatMessage; onImageClick: (url: string) => void }) {
  if (props.msg.role === "user") {
    return <div class="msg-user"><div class="bubble">{props.msg.text}</div></div>;
  }
  const cls = () => ({ user: "tl-system", agent: "tl-agent", tool: "tl-tool", media: "tl-media", system: "tl-system" }[props.msg.role] || "tl-system");
  const icon = () => ({ user: "你", agent: "AI", tool: "⚙", media: "◉", system: "·" }[props.msg.role] || "·");
  return (
    <div class="msg-row">
      <div class={`msg-avatar ${cls()}`}>{icon()}</div>
      <div class={`msg-content ${props.msg.role === "agent" ? "agent" : ""}`}>
        {props.msg.text}
        <Show when={props.msg.mediaUrl}>
          <div>
            <img class="msg-img" src={props.msg.mediaUrl} alt=""
              onDblClick={() => props.onImageClick(props.msg.mediaUrl!)}
              style={{ cursor: "zoom-in" }} title="双击查看大图" />
            <Show when={props.msg.slotCode}><span class="slot-badge" style={{ "margin-left": "6px" }}>{props.msg.slotCode}</span></Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
