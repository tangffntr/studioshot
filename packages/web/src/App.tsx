/**
 * web/src/App.tsx — 电商出图工作台（编辑部深色风格）
 * 保留全部功能：上传/模板/出图/画廊/设置/轨迹
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
    <div class="app-shell">
      {/* 顶部 header */}
      <header class="app-header">
        <div class="app-logo font-display">
          Studio<span class="dot">.</span>Shot
        </div>
        <div class="status-pill">
          <span class={`status-dot ${state.connected ? "" : "off"}`}></span>
          <Show when={state.connected} fallback="未连接">{state.jobStatus ? `${state.jobStatus} ${state.jobProgress > 0 ? state.jobProgress.toFixed(0) + "%" : ""}` : "就绪"}</Show>
        </div>
      </header>

      {/* 工作区 */}
      <div class="workspace">
        {/* 左：控制面板 */}
        <aside class="control-panel">
          <div class="section-block">
            <div class="section-label"><span class="num">01</span> 产品上传</div>
            <input class="field" type="text" placeholder="产品名称" value={productName()} onInput={(e) => setProductName(e.currentTarget.value)} />
            <div style={{ "margin-top": "10px" }}>
              <label class={`upload-zone ${previewUrl() ? "has-img" : ""}`} style={{ display: "block" }}>
                <Show when={previewUrl()} fallback={
                  <div>
                    <div style={{ "font-size": "24px", "margin-bottom": "6px" }}>+</div>
                    <div style={{ "font-size": "12px", color: "var(--fg-dim)" }}>点击或拖拽上传产品图</div>
                  </div>
                }>
                  <img class="upload-preview" src={previewUrl()} alt="预览" />
                </Show>
                <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
              </label>
            </div>
            <button class="btn btn-ghost btn-block btn-sm" onClick={upload} disabled={busy() || !productImg()} style={{ "margin-top": "10px" }}>上传</button>
            <Show when={productId()}>
              <div class="hint hint-accent" style={{ "margin-top": "6px" }}>✓ 已就绪</div>
            </Show>
          </div>

          <div class="section-block">
            <div class="section-label"><span class="num">02</span> 模板</div>
            <select class="field" value={selectedTpl()} onChange={(e) => setSelectedTpl(e.currentTarget.value)}>
              <option value="">单图 Agent 模式</option>
              <For each={templates()}>
                {(t) => <option value={t.id}>{t.name} · {t.slotCount} 图</option>}
              </For>
            </select>
            <Show when={selectedTpl()}>
              <div class="hint hint-accent">⚡ Pipeline · {templates().find((t) => t.id === selectedTpl())?.slotCount} 张图</div>
            </Show>
          </div>

          <div class="section-block">
            <div class="section-label"><span class="num">03</span> 指令</div>
            <Show when={!selectedTpl()}>
              <textarea class="field" value={instruction()} onInput={(e) => setInstruction(e.currentTarget.value)} rows={3} />
            </Show>
            <Show when={selectedTpl()}>
              <div class="hint">模板自动渲染全部图位 prompt</div>
            </Show>
            <button class="btn btn-primary btn-block" onClick={submitJob} disabled={busy() || !productId()} style={{ "margin-top": "12px" }}>
              开始出图 →
            </button>
            <Show when={error()}><div class="error-msg">{error()}</div></Show>
            <Show when={state.jobStatus === "running"}>
              <div class="progress-track"><div class="progress-fill" style={{ width: `${state.jobProgress}%` }}></div></div>
            </Show>
          </div>
        </aside>

        {/* 右：产出区 */}
        <main class="output-panel">
          <div class="divider-label">Agent Timeline</div>
          <div class="timeline">
            <Show when={state.timeline.length === 0} fallback={
              <For each={state.timeline}>{(item) => <TimelineRow item={item} />}</For>
            }>
              <div class="timeline-empty">
                <div style={{ "font-size": "28px", opacity: 0.3 }}>◇</div>
                <div>提交任务后，Agent 的思考与工具调用将实时呈现</div>
              </div>
            </Show>
          </div>

          <Show when={state.mediaList.length > 0}>
            <div class="divider-label">Generated</div>
            <div class="media-grid">
              <For each={state.mediaList}>
                {(m) => (
                  <div class="media-card">
                    <img src={m.url} alt={m.promptText || ""} />
                    <div class="media-meta">
                      <Show when={m.promptText}><span class="hint" style={{ "max-width": "120px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{m.promptText}</span></Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <GallerySection />
          <SettingsSection />
        </main>
      </div>
    </div>
  );
}

/** 素材画廊 */
function GallerySection() {
  const [galleryProducts, setGalleryProducts] = createSignal<Array<{ id: string; name: string }>>([]);
  const [selProduct, setSelProduct] = createSignal<string>("");
  const [galleryMedia, setGalleryMedia] = createSignal<Array<any>>([]);
  const [confirmDel, setConfirmDel] = createSignal<string | null>(null);

  const refreshProducts = async () => {
    const r = await fetch("/api/products").then((r) => r.json());
    setGalleryProducts(r);
    if (r.length && !selProduct()) { setSelProduct(r[0].id); await loadMedia(r[0].id); }
    else if (selProduct()) { await loadMedia(selProduct()); }
  };
  const loadMedia = async (pid: string) => { const r = await fetch(`/api/media?productId=${pid}`).then((r) => r.json()); setGalleryMedia(r); };
  const deleteMedia = async (mid: string) => { await fetch(`/api/media/${mid}`, { method: "DELETE" }); setConfirmDel(null); await loadMedia(selProduct()); };
  onMount(() => { refreshProducts(); setInterval(refreshProducts, 5000); });

  return (
    <div class="card-section">
      <h2 class="font-display">素材库</h2>
      <div style={{ display: "flex", gap: "10px", "align-items": "center", "margin-bottom": "16px" }}>
        <select class="field" style={{ width: "auto" }} value={selProduct()} onChange={async (e) => { setSelProduct(e.currentTarget.value); await loadMedia(e.currentTarget.value); }}>
          <For each={galleryProducts()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <span class="hint">{galleryMedia().length} 项</span>
      </div>
      <Show when={galleryMedia().length === 0} fallback={
        <div class="media-grid">
          <For each={galleryMedia()}>
            {(m) => (
              <div class="media-card">
                <img src={m.url} alt="" />
                <div class="media-meta">
                  <Show when={m.slotCode}><span class="slot-badge">{m.slotCode}</span></Show>
                  <Show when={m.sortOrder}><span class="hint">#{m.sortOrder}</span></Show>
                </div>
                <div class="media-actions" style={{ padding: "0 10px 8px" }}>
                  <a href={m.url} download="">下载</a>
                  <Show when={confirmDel() === m.id} fallback={
                    <a class="danger" onClick={(e) => { e.preventDefault(); setConfirmDel(m.id); }}>删除</a>
                  }>
                    <a class="danger" onClick={(e) => { e.preventDefault(); deleteMedia(m.id); }}>确认</a>
                    <a onClick={(e) => { e.preventDefault(); setConfirmDel(null); }}>取消</a>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      }>
        <div class="hint">该产品暂无素材</div>
      </Show>
    </div>
  );
}

/** 模型设置 */
function SettingsSection() {
  const [settings, setSettings] = createSignal<any>(null);
  const [editVendor, setEditVendor] = createSignal<string | null>(null);
  const [credInputs, setCredInputs] = createSignal<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = createSignal("");

  const load = async () => { try { setSettings(await fetch("/api/settings").then((r) => r.json())); } catch {} };
  onMount(load);
  const startEdit = (v: any) => { setEditVendor(v.id); const inputs: Record<string, string> = {}; v.inputs.forEach((i: any) => { inputs[i.key] = v.baseUrl && i.key === "baseUrl" ? v.baseUrl : ""; }); setCredInputs(inputs); setSavedMsg(""); };
  const saveCreds = async (vendorId: string) => { await fetch("/api/settings/credentials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendorId, values: credInputs() }) }); setEditVendor(null); setSavedMsg(`${vendorId} 已保存`); await load(); };
  const bindSlot = async (slotKey: string, modelId: string) => { await fetch("/api/settings/task-slot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotKey, modelId }) }); setSavedMsg(`${slotKey} 已绑定`); await load(); };

  return (
    <div class="card-section">
      <h2 class="font-display">模型配置</h2>
      <Show when={savedMsg()}><div class="saved-msg">✓ {savedMsg()}</div></Show>
      <Show when={settings()}>
        <div class="vendor-grid">
          <For each={settings().vendors || []}>
            {(v: any) => (
              <div class="vendor-card">
                <div class="vendor-name">{v.name}</div>
                <div class="vendor-meta">{v.id} · {v.adapter}</div>
                <div class="cred-status">凭证：<span class={v.hasCredentials ? "cred-ok" : "cred-no"}>{v.hasCredentials ? "✓ 已配置" : "✗ 未配置"}</span></div>
                <Show when={editVendor() === v.id} fallback={
                  <button class="btn btn-ghost btn-sm" onClick={() => startEdit(v)}>{v.hasCredentials ? "修改" : "配置"}</button>
                }>
                  <For each={v.inputs}>{(input: any) => (
                    <input class="field" type={input.type} placeholder={input.label} value={credInputs()[input.key] || ""} onInput={(e) => setCredInputs({ ...credInputs(), [input.key]: e.currentTarget.value })} style={{ "margin-bottom": "6px" }} />
                  )}</For>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button class="btn btn-primary btn-sm" onClick={() => saveCreds(v.id)}>保存</button>
                    <button class="btn btn-ghost btn-sm" onClick={() => setEditVendor(null)}>取消</button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
        <div class="divider-label" style={{ "margin-top": "24px" }}>任务槽绑定</div>
        <For each={settings().taskSlots || []}>
          {(slot: any) => {
            const allModels = (settings().vendors || []).flatMap((v: any) => v.models);
            return (
              <div class="slot-row">
                <span class="slot-key">{slot.slotKey}</span>
                <select class="field" style={{ width: "auto", "font-size": "12px" }} value={slot.modelId || ""} onChange={(e) => bindSlot(slot.slotKey, e.currentTarget.value)}>
                  <For each={allModels}>{(m: any) => <option value={m.id}>{m.id}</option>}</For>
                </select>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

function TimelineRow(props: { item: any }) {
  const cls = () => {
    switch (props.item.type) {
      case "agent": return "tl-agent";
      case "tool": return "tl-tool";
      case "media": return "tl-media";
      default: return "tl-system";
    }
  };
  const icon = () => {
    switch (props.item.type) {
      case "agent": return "AI";
      case "tool": return "⚙";
      case "media": return "◉";
      default: return "·";
    }
  };
  return (
    <div class="timeline-row">
      <div class={`timeline-icon ${cls()}`}>{icon()}</div>
      <div style={{ flex: 1 }}>
        <div class={`timeline-text ${props.item.type === "agent" ? "agent" : ""}`}>{props.item.text || props.item.toolName}</div>
        <Show when={props.item.mediaUrl}>
          <img src={props.item.mediaUrl} style={{ "max-width": "120px", "border-radius": "4px", "margin-top": "6px" }} alt="" />
        </Show>
      </div>
    </div>
  );
}
