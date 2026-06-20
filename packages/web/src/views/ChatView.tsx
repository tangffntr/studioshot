/**
 * web/src/views/ChatView.tsx — 聊天视图
 * Agent 思想在消息流展示 + 底部输入框（模式选择 + 产品图上传）
 */
import { createSignal, Show, For } from "solid-js";
import { state, setState } from "../context/store";
import type { ChatMessage } from "../context/store";

const MODES = [
  { key: "agent", label: "Agent 单图" },
  { key: "template", label: "模板套图" },
  { key: "scene-swap", label: "场景替换" },
  { key: "tryon", label: "虚拟试穿" },
  { key: "video", label: "视频生成" },
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
  const [text, setText] = createSignal("");
  const [productImg, setProductImg] = createSignal<File | null>(null);
  const [imgName, setImgName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  let fileInput: HTMLInputElement | undefined;

  const onFile = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) { setProductImg(f); setImgName(f.name); }
  };

  const send = async () => {
    if (!text().trim() && !productImg()) return;
    setError("");
    setBusy(true);

    setState("messages", (m) => [...m, { id: crypto.randomUUID(), role: "user", text: text() || `[${mode()}] 出图请求`, ts: Date.now() }]);
    // 新 job 开始时清空产出栏
    setState("outputMedia", []);

    try {
      const jobBody: any = { instruction: text() || "生成图片" };
      // 有产品图才上传（可选附件）
      if (productImg()) {
        const b64 = await fileToBase64(productImg()!);
        const up = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: imgName(), imageBase64: b64, imageMime: "image/png" }) }).then((r) => r.json());
        jobBody.productId = up.productId;
        jobBody.attachments = [up.mediaId];
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
      {/* 消息流 */}
      <div class="chat-stream">
        <div class="chat-inner">
          <Show when={state.messages.length === 0}>
            <div style={{ "text-align": "center", color: "var(--fg-mute)", padding: "60px 0" }}>
              <div style={{ "font-size": "36px", "margin-bottom": "12px", opacity: 0.3 }}>✦</div>
              <div class="font-display" style={{ "font-size": "20px", "margin-bottom": "6px" }}>Studio.Shot</div>
              <div style={{ "font-size": "13px" }}>上传产品图，选择模式，描述需求，开始出图</div>
            </div>
          </Show>
          <For each={state.messages}>{(msg: ChatMessage) => <MessageRow msg={msg} />}</For>
        </div>
      </div>

      {/* 输入区 */}
      <div class="chat-input-area">
        <div class="chat-input-inner">
          <div class="mode-selector">
            <For each={MODES}>{(m) => (
              <span class={`mode-chip ${mode() === m.key ? "active" : ""}`} onClick={() => setMode(m.key)}>{m.label}</span>
            )}</For>
            <span class={`upload-chip ${imgName() ? "has-file" : ""}`} onClick={() => fileInput?.click()}>
              {imgName() ? `📎 ${imgName().slice(0, 16)}` : "📎 产品图"}
            </span>
            <input ref={fileInput} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
          </div>
          <div class="input-row">
            <textarea value={text()} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={onKeyDown}
              placeholder={mode() === "template" ? "模板套图，描述可选..." : "描述你想要的图片..."} rows={1} />
            <button class="send-btn" onClick={send} disabled={busy() || (!text().trim() && !productImg())}>↑</button>
          </div>
          <Show when={error()}><div class="error-msg">{error()}</div></Show>
        </div>
      </div>
    </div>
  );
}

function MessageRow(props: { msg: ChatMessage }) {
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
          <div><img class="msg-img" src={props.msg.mediaUrl} alt="" />
            <Show when={props.msg.slotCode}><span class="slot-badge" style={{ "margin-left": "6px" }}>{props.msg.slotCode}</span></Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
