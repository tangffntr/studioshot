/**
 * web/src/App.tsx — 对话工作台（首里程碑 UI）
 * 上传产品图 → 提交出图任务 → 实时显示 Agent 轨迹 + 生成图
 */
import { createSignal, onMount, Show, For } from "solid-js";
import { state, setState, connectSSE } from "./context/store";

const API = {
  uploadProduct: async (name: string, file: File): Promise<{ productId: string; mediaId: string }> => {
    const b64 = await fileToBase64(file);
    const r = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, imageBase64: b64, imageMime: file.type || "image/png" }),
    });
    return r.json();
  },
  createJob: async (productId: string, instruction: string, mediaId: string): Promise<{ jobId: string }> => {
    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, instruction, attachments: [mediaId] }),
    });
    return r.json();
  },
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去 data: 前缀
      const comma = result.indexOf(",");
      resolve(comma > 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [productName, setProductName] = createSignal("");
  const [productImg, setProductImg] = createSignal<File | null>(null);
  const [previewUrl, setPreviewUrl] = createSignal("");
  const [instruction, setInstruction] = createSignal("分析这款产品并生成一张白底主图");
  const [busy, setBusy] = createSignal(false);
  const [productId, setProductId] = createSignal<string | null>(null);
  const [mediaId, setMediaId] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");

  onMount(() => connectSSE());

  const onFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      setProductImg(file);
      setPreviewUrl(URL.createObjectURL(file));
      if (!productName()) setProductName(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const upload = async () => {
    if (!productImg()) return setError("请选择产品图");
    setBusy(true);
    setError("");
    try {
      const r = await API.uploadProduct(productName() || "未命名产品", productImg()!);
      setProductId(r.productId);
      setMediaId(r.mediaId);
    } catch (e: any) {
      setError(e.message || "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const submitJob = async () => {
    if (!productId() || !mediaId()) return setError("请先上传产品图");
    setBusy(true);
    setError("");
    setState("timeline", []);
    setState("mediaList", []);
    setState("jobProgress", 0);
    try {
      const r = await API.createJob(productId()!, instruction(), mediaId()!);
      setState("currentJobId", r.jobId);
      setState("jobStatus", "queued");
    } catch (e: any) {
      setError(e.message || "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ "max-width": "1100px", margin: "0 auto", padding: "24px", "font-family": "system-ui, sans-serif" }}>
      <h1 style={{ "margin-bottom": "4px" }}>🛒 电商出图 Agent</h1>
      <div style={{ color: "#888", "margin-bottom": "24px" }}>
        <Show when={state.connected} fallback={<span style={{ color: "#dc2626" }}>● 未连接</span>}>
          <span style={{ color: "#16a34a" }}>● 已连接</span>
        </Show>
        <Show when={state.jobStatus}>
          {"  ·  状态："}<b>{state.jobStatus}</b>
          <Show when={state.jobProgress > 0 && state.jobStatus === "running"}>
            {"  "}{state.jobProgress.toFixed(0)}%
          </Show>
        </Show>
      </div>

      <div style={{ display: "flex", gap: "24px", "flex-wrap": "wrap" }}>
        {/* 左：上传 + 指令 */}
        <div style={{ flex: "1 1 320px" }}>
          <h3>1. 上传产品图</h3>
          <input type="text" placeholder="产品名称" value={productName()} onInput={(e) => setProductName(e.currentTarget.value)} style={inputStyle} />
          <input type="file" accept="image/*" onChange={onFile} style={{ "margin-top": "8px" }} />
          <Show when={previewUrl()}>
            <img src={previewUrl()} style={{ "max-width": "100%", "max-height": "200px", "margin-top": "8px", border: "1px solid #ddd" }} />
          </Show>
          <button onClick={upload} disabled={busy() || !productImg()} style={btnStyle}>上传产品</button>
          <Show when={productId()}>
            <div style={{ color: "#16a34a", "font-size": "13px", "margin-top": "4px" }}>✓ 已上传 (media: {mediaId()?.slice(0, 8)}…)</div>
          </Show>

          <h3 style={{ "margin-top": "24px" }}>2. 提交出图任务</h3>
          <textarea
            value={instruction()}
            onInput={(e) => setInstruction(e.currentTarget.value)}
            rows={3}
            style={{ ...inputStyle, "font-family": "inherit", "vertical-align": "top" }}
          />
          <button onClick={submitJob} disabled={busy() || !productId()} style={btnStyle}>▶ 开始出图</button>
          <Show when={error()}>
            <div style={{ color: "#dc2626", "font-size": "13px", "margin-top": "4px" }}>{error()}</div>
          </Show>
        </div>

        {/* 右：Agent 轨迹 */}
        <div style={{ flex: "1 1 420px" }}>
          <h3>Agent 轨迹</h3>
          <div style={{ border: "1px solid #ddd", "border-radius": "8px", padding: "12px", "min-height": "300px", "max-height": "500px", "overflow-y": "auto", background: "#fafafa" }}>
            <Show when={state.timeline.length === 0} fallback={
              <For each={state.timeline}>
                {(item) => <TimelineRow item={item} />}
              </For>
            }>
              <div style={{ color: "#999" }}>提交任务后，这里会实时显示 Agent 的思考和工具调用。</div>
            </Show>
          </div>

          <Show when={state.mediaList.length > 0}>
            <h3 style={{ "margin-top": "16px" }}>生成的图</h3>
            <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap" }}>
              <For each={state.mediaList}>
                {(m) => (
                  <div>
                    <img src={m.url} style={{ width: "180px", border: "1px solid #ddd", "border-radius": "6px" }} />
                    <Show when={m.promptText}>
                      <div style={{ "font-size": "11px", color: "#888", "max-width": "180px", "margin-top": "4px" }}>{m.promptText?.slice(0, 60)}…</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

function TimelineRow(props: { item: any }) {
  const color = () => {
    switch (props.item.type) {
      case "agent": return "#2563eb";
      case "tool": return "#7c3aed";
      case "media": return "#16a34a";
      case "system": return "#888";
      default: return "#333";
    }
  };
  const icon = () => {
    switch (props.item.type) {
      case "agent": return "🤖";
      case "tool": return "🔧";
      case "media": return "🖼️";
      case "system": return "•";
      default: return "•";
    }
  };
  return (
    <div style={{ "margin-bottom": "8px", "padding-left": "4px", "border-left": `3px solid ${color()}` }}>
      <span style={{ "margin-right": "6px" }}>{icon()}</span>
      <span style={{ "font-weight": props.item.type === "agent" ? 600 : 400, color: color() }}>
        {props.item.text || props.item.toolName}
      </span>
      <Show when={props.item.mediaUrl}>
        <div style={{ "margin-top": "4px" }}>
          <img src={props.item.mediaUrl} style={{ "max-width": "120px", "border-radius": "4px" }} />
        </div>
      </Show>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  "border-radius": "4px",
  border: "1px solid #ccc",
  "margin-top": "4px",
  "box-sizing": "border-box" as const,
};
const btnStyle = {
  "margin-top": "8px",
  padding: "8px 16px",
  background: "#2563eb",
  color: "white",
  border: "none",
  "border-radius": "4px",
  cursor: "pointer",
};