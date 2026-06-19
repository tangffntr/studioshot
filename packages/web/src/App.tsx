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
  createJob: async (productId: string, instruction: string, mediaId: string, templateId?: string): Promise<{ jobId: string }> => {
    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, instruction, attachments: [mediaId], templateId }),
    });
    return r.json();
  },
  fetchTemplates: async (): Promise<Array<{ id: string; name: string; slotCount: number; description: string | null }>> => {
    const r = await fetch("/api/templates");
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
  const [templates, setTemplates] = createSignal<Array<{ id: string; name: string; slotCount: number; description: string | null }>>([]);
  const [selectedTpl, setSelectedTpl] = createSignal<string>("");

  onMount(async () => {
    connectSSE();
    try { setTemplates(await API.fetchTemplates()); } catch {}
  });

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
      const r = await API.createJob(productId()!, instruction(), mediaId()!, selectedTpl() || undefined);
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

          <h3 style={{ "margin-top": "24px" }}>2. 选择模板（可选）</h3>
          <select
            value={selectedTpl()}
            onChange={(e) => setSelectedTpl(e.currentTarget.value)}
            style={inputStyle}
          >
            <option value="">不使用模板（单图 Agent 模式）</option>
            <For each={templates()}>
              {(t) => <option value={t.id}>{t.name}（{t.slotCount} 图位）</option>}
            </For>
          </select>
          <Show when={selectedTpl()}>
            <div style={{ "font-size": "12px", color: "#7c3aed", "margin-top": "4px" }}>
              ⚡ Pipeline 模式：将按模板确定性生成 {templates().find((t) => t.id === selectedTpl())?.slotCount} 张图（约 8-10 分钟）
            </div>
          </Show>

          <h3 style={{ "margin-top": "24px" }}>3. 提交出图任务</h3>
          <Show when={!selectedTpl()}>
            <textarea
              value={instruction()}
              onInput={(e) => setInstruction(e.currentTarget.value)}
              rows={3}
              style={{ ...inputStyle, "font-family": "inherit", "vertical-align": "top" }}
            />
          </Show>
          <Show when={selectedTpl()}>
            <div style={{ ...inputStyle, color: "#888", "min-height": "40px" }}>模板将自动渲染所有图位的 prompt，无需手动输入指令</div>
          </Show>
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

      {/* 素材画廊区 */}
      <GallerySection />
    </div>
  );
}

/** 素材画廊：按产品查看历史图，含 slotCode 标签、下载、删除 */
function GallerySection() {
  const [galleryProducts, setGalleryProducts] = createSignal<Array<{ id: string; name: string }>>([]);
  const [selProduct, setSelProduct] = createSignal<string>("");
  const [galleryMedia, setGalleryMedia] = createSignal<Array<any>>([]);
  const [confirmDel, setConfirmDel] = createSignal<string | null>(null);

  const refreshProducts = async () => {
    const r = await fetch("/api/products").then((r) => r.json());
    setGalleryProducts(r);
    if (r.length && !selProduct()) { setSelProduct(r[0].id); await loadMedia(r[0].id); }
    else if (selProduct()) { await loadMedia(selProduct()); } // 刷新当前产品媒体
  };

  const loadMedia = async (pid: string) => {
    const r = await fetch(`/api/media?productId=${pid}`).then((r) => r.json());
    setGalleryMedia(r);
  };

  const deleteMedia = async (mid: string) => {
    await fetch(`/api/media/${mid}`, { method: "DELETE" });
    setConfirmDel(null);
    await loadMedia(selProduct());
  };

  onMount(() => {
    refreshProducts();
    // 自动刷新（5s，便于看到生成中的新图 + 上传后的新产品）
    setInterval(refreshProducts, 5000);
  });

  return (
    <div style={{ "margin-top": "32px", "border-top": "1px solid #eee", "padding-top": "16px" }}>
      <h2>📁 素材画廊</h2>
      <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "12px" }}>
        <select
          value={selProduct()}
          onChange={async (e) => { setSelProduct(e.currentTarget.value); await loadMedia(e.currentTarget.value); }}
          style={{ ...inputStyle, width: "auto" }}
        >
          <For each={galleryProducts()}>
            {(p) => <option value={p.id}>{p.name}</option>}
          </For>
        </select>
        <button onClick={() => refreshProducts()} style={{ ...btnStyle, "margin-top": "0", padding: "6px 12px" }}>刷新</button>
        <span style={{ "font-size": "12px", color: "#888" }}>{galleryMedia().length} 张图</span>
      </div>

      <Show when={galleryMedia().length === 0} fallback={
        <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
          <For each={galleryMedia()}>
            {(m) => (
              <div style={{ border: "1px solid #ddd", "border-radius": "6px", padding: "6px", background: "#fff" }}>
                <img src={m.url} style={{ width: "100%", height: "140px", "object-fit": "cover", "border-radius": "4px" }} />
                <Show when={m.slotCode}>
                  <span style={{ "font-size": "10px", background: "#2563eb", color: "#fff", padding: "1px 5px", "border-radius": "3px", "margin-top": "4px", display: "inline-block" }}>{m.slotCode}</span>
                </Show>
                <Show when={m.sortOrder}>
                  <span style={{ "font-size": "10px", color: "#888", "margin-left": "4px" }}>#{m.sortOrder}</span>
                </Show>
                <div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
                  <a href={m.url} download="" style={{ "font-size": "11px", color: "#2563eb" }}>下载</a>
                  <Show when={confirmDel() === m.id} fallback={
                    <a href="#" onClick={(e) => { e.preventDefault(); setConfirmDel(m.id); }} style={{ "font-size": "11px", color: "#dc2626", "margin-left": "8px" }}>删除</a>
                  }>
                    <a href="#" onClick={(e) => { e.preventDefault(); deleteMedia(m.id); }} style={{ "font-size": "11px", color: "#dc2626", "margin-left": "8px" }}>确认删除</a>
                    <a href="#" onClick={(e) => { e.preventDefault(); setConfirmDel(null); }} style={{ "font-size": "11px", color: "#888", "margin-left": "4px" }}>取消</a>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      }>
        <div style={{ color: "#999" }}>该产品暂无素材。生成图片后会出现在这里。</div>
      </Show>
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