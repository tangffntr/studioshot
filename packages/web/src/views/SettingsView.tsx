/** web/src/views/SettingsView.tsx — 完整模型配置（apiKey + baseUrl + 模型增删 + 任务槽 + 自定义供应商 + 备用模型） */
import { createSignal, For, Show, onMount } from "solid-js";

export default function SettingsView() {
  const [settings, setSettings] = createSignal<any>(null);
  const [editVendor, setEditVendor] = createSignal<string | null>(null);
  const [apiKey, setApiKey] = createSignal("");
  const [baseUrl, setBaseUrl] = createSignal("");
  const [savedMsg, setSavedMsg] = createSignal("");
  // 添加模型
  const [showAddModel, setShowAddModel] = createSignal<string | null>(null);
  const [newModelName, setNewModelName] = createSignal("");
  const [newModelType, setNewModelType] = createSignal("image");
  // 添加供应商
  const [showAddVendor, setShowAddVendor] = createSignal(false);
  const [newVendorId, setNewVendorId] = createSignal("");
  const [newVendorName, setNewVendorName] = createSignal("");
  const [newVendorCategory, setNewVendorCategory] = createSignal("image");
  const [newVendorAdapter, setNewVendorAdapter] = createSignal("");
  const [newVendorBaseUrl, setNewVendorBaseUrl] = createSignal("");

  const load = async () => { try { setSettings(await fetch("/api/settings").then((r) => r.json())); } catch {} };
  onMount(load);

  const startEdit = (v: any) => {
    setEditVendor(v.id);
    setApiKey(v.apiKey || "");
    setBaseUrl(v.baseUrl || "");
    setSavedMsg("");
  };

  const saveCreds = async (vendorId: string) => {
    await fetch("/api/settings/credentials", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, apiKey: apiKey(), baseUrl: baseUrl() }),
    });
    setEditVendor(null);
    setSavedMsg(`${vendorId} 配置已保存`);
    await load();
  };

  const addModel = async (vendorId: string) => {
    if (!newModelName()) return;
    await fetch("/api/settings/models", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, modelName: newModelName(), type: newModelType(), displayName: newModelName() }),
    });
    setShowAddModel(null); setNewModelName(""); setNewModelType("image");
    await load();
  };

  const delModel = async (modelId: string) => {
    await fetch(`/api/settings/models/${modelId}`, { method: "DELETE" });
    await load();
  };

  const addVendor = async () => {
    if (!newVendorId() || !newVendorName() || !newVendorAdapter()) return;
    const res = await fetch("/api/settings/vendor", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newVendorId(), name: newVendorName(), category: newVendorCategory(),
        adapter: newVendorAdapter(), baseUrl: newVendorBaseUrl() || undefined,
      }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); setSavedMsg(e.error || "创建失败"); return; }
    setShowAddVendor(false);
    setNewVendorId(""); setNewVendorName(""); setNewVendorCategory("image"); setNewVendorAdapter(""); setNewVendorBaseUrl("");
    setSavedMsg("供应商已创建");
    await load();
  };

  const delVendor = async (vendorId: string) => {
    if (!confirm(`确认删除供应商 ${vendorId}？该操作会同时删除其下所有模型和凭证。`)) return;
    await fetch(`/api/settings/vendor/${vendorId}`, { method: "DELETE" });
    setSavedMsg(`供应商 ${vendorId} 已删除`);
    await load();
  };

  const bindSlot = async (slotKey: string, modelId: string, backupModelId?: string) => {
    const body: Record<string, string> = { slotKey };
    if (modelId !== undefined) body.modelId = modelId;
    if (backupModelId !== undefined) body.backupModelId = backupModelId;
    await fetch("/api/settings/task-slot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSavedMsg(`${slotKey} 已绑定`);
    await load();
  };

  const updateCellSize = async (modelId: string, cellSize: number) => {
    await fetch(`/api/settings/models/${modelId}/cell-size`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cellSize }),
    });
    setSavedMsg(`${modelId} cellSize 已更新为 ${cellSize}`);
    await load();
  };

  const cellSizeLabel = (cs: number) => cs >= 1024 ? `${cs / 1024}k` : `${cs}`;
  const cellSizeOptions = [512, 1024, 2048, 4096];

  const categories = ["image", "video", "vlm", "tryon", "matting"];

  // 模型类型标签映射
  const typeLabels: Record<string, { text: string; color: string }> = {
    image: { text: "图像", color: "#4ecdc4" },
    video: { text: "视频", color: "#ff6b6b" },
    vlm: { text: "多模态", color: "#ffd93d" },
    tryon: { text: "试穿", color: "#c084fc" },
    matting: { text: "抠图", color: "#6ecff6" },
  };

  return (
    <div class="view-page">
      <h1 class="font-display">模型设置</h1>
      <Show when={savedMsg()}><div class="saved-msg">✓ {savedMsg()}</div></Show>

      <Show when={settings()}>
        <div class="divider-label">
          供应商配置
          <button class="btn btn-ghost btn-sm" style={{ "margin-left": "12px" }} onClick={() => setShowAddVendor(!showAddVendor())}>
            {showAddVendor() ? "取消" : "+ 添加供应商"}
          </button>
        </div>

        {/* 添加供应商表单 */}
        <Show when={showAddVendor()}>
          <div class="add-vendor-form">
            <div class="form-row">
              <input class="field" placeholder="供应商 ID（如 my-vendor）" value={newVendorId()} onInput={(e) => setNewVendorId(e.currentTarget.value)} />
              <input class="field" placeholder="显示名称" value={newVendorName()} onInput={(e) => setNewVendorName(e.currentTarget.value)} />
            </div>
            <div class="form-row">
              <select class="field" value={newVendorCategory()} onChange={(e) => setNewVendorCategory(e.currentTarget.value)}>
                <For each={categories}>{(c) => <option value={c}>{c}</option>}</For>
              </select>
              <select class="field" value={newVendorAdapter()} onChange={(e) => setNewVendorAdapter(e.currentTarget.value)}>
                <option value="">选择适配器...</option>
                <For each={settings()?.availableAdapters || []}>{(a: string) => <option value={a}>{a}</option>}</For>
              </select>
            </div>
            <div class="form-row">
              <input class="field" placeholder="Base URL（可选）" value={newVendorBaseUrl()} onInput={(e) => setNewVendorBaseUrl(e.currentTarget.value)} />
              <button class="btn btn-primary" onClick={addVendor}>创建</button>
            </div>
          </div>
        </Show>

        <div class="vendor-grid">
          <For each={settings().vendors || []}>{(v: any) => (
            <div class="vendor-card">
              <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                <div>
                  <div class="vendor-name">{v.name}</div>
                  <div class="vendor-meta">{v.id} · {v.adapter}</div>
                </div>
                <a class="danger" style={{ "font-size": "11px", color: "var(--danger)", cursor: "pointer" }} onClick={() => delVendor(v.id)}>删除</a>
              </div>

              {/* API Key + BaseUrl */}
              <Show when={editVendor() === v.id} fallback={
                <div>
                  <div class="cred-status">
                    凭证：<span class={v.hasCredentials ? "cred-ok" : "cred-no"}>{v.hasCredentials ? "✓ 已配置" : "✗ 未配置"}</span>
                    {v.baseUrl && <span class="vendor-meta"> · {v.baseUrl}</span>}
                  </div>
                  <div style={{ display: "flex", gap: "6px", "margin-top": "6px" }}>
                    <button class="btn btn-ghost btn-sm" onClick={() => startEdit(v)}>{v.hasCredentials ? "编辑" : "配置"}</button>
                    <button class="btn btn-ghost btn-sm" onClick={() => setShowAddModel(showAddModel() === v.id ? null : v.id)}>+ 模型</button>
                  </div>
                </div>
              }>
                <div style={{ "margin-top": "8px" }}>
                  <label class="hint">API Key</label>
                  <input class="field" type="password" placeholder="sk-..." value={apiKey()} onInput={(e) => setApiKey(e.currentTarget.value)} style={{ "margin-bottom": "6px" }} />
                  <label class="hint">Base URL</label>
                  <input class="field" type="text" placeholder="https://..." value={baseUrl()} onInput={(e) => setBaseUrl(e.currentTarget.value)} style={{ "margin-bottom": "6px" }} />
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button class="btn btn-primary btn-sm" onClick={() => saveCreds(v.id)}>保存</button>
                    <button class="btn btn-ghost btn-sm" onClick={() => setEditVendor(null)}>取消</button>
                  </div>
                </div>
              </Show>

              {/* 添加模型 */}
              <Show when={showAddModel() === v.id}>
                <div style={{ "margin-top": "10px", "padding-top": "8px", "border-top": "1px solid var(--border)" }}>
                  <input class="field" placeholder="模型名（如 gpt-image-2）" value={newModelName()} onInput={(e) => setNewModelName(e.currentTarget.value)} style={{ "margin-bottom": "4px", "font-size": "12px" }} />
                  <select class="field" value={newModelType()} onChange={(e) => setNewModelType(e.currentTarget.value)} style={{ "margin-bottom": "6px", "font-size": "12px" }}>
                    <For each={categories}>{(c) => <option value={c}>{c}</option>}</For>
                  </select>
                  <button class="btn btn-primary btn-sm" onClick={() => addModel(v.id)}>添加</button>
                </div>
              </Show>

              {/* 模型列表 */}
              <div style={{ "margin-top": "8px" }}>
                <For each={v.models}>{(m: any) => {
                  const tl = typeLabels[m.type] || { text: m.type, color: "#888" };
                  return (
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "font-size": "11px", "font-family": "JetBrains Mono, monospace", color: "var(--fg-dim)", "margin-bottom": "3px" }}>
                      <span style={{ flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{m.modelName}</span>
                      {/* 类型标签 */}
                      <span style={{ "font-size": "9px", padding: "1px 4px", "border-radius": "3px", background: tl.color + "22", color: tl.color, "margin-left": "6px", "white-space": "nowrap" }}>{tl.text}</span>
                      {/* cellSize 选择器（仅图像模型显示） */}
                      <Show when={m.type === "image"}>
                        <select
                          style={{ "font-size": "10px", "padding": "1px 4px", "border": "1px solid var(--border)", "border-radius": "3px", "background": "var(--bg-card)", color: "var(--fg-dim)", cursor: "pointer", "margin-left": "4px" }}
                          value={m.cellSize || 1024}
                          onChange={(e) => updateCellSize(m.id, Number(e.currentTarget.value))}
                        >
                          <For each={cellSizeOptions}>{(cs) => <option value={cs}>{cellSizeLabel(cs)}</option>}</For>
                        </select>
                      </Show>
                      <a class="danger" style={{ "font-size": "10px", color: "var(--danger)", cursor: "pointer", "margin-left": "4px" }} onClick={() => delModel(m.id)}>✕</a>
                    </div>
                  );
                }}</For>
              </div>
            </div>
          )}</For>
        </div>

        {/* 任务槽绑定 */}
        <div class="divider-label" style={{ "margin-top": "24px" }}>任务槽绑定</div>
        <For each={settings().taskSlots || []}>{(slot: any) => {
          const allModels = (settings().vendors || []).flatMap((v: any) => v.models);
          return (
            <div class="slot-row">
              <span class="slot-key">{slot.slotKey}</span>
              <div class="slot-binding">
                <span class="slot-label">主模型</span>
                <select class="field" style={{ width: "auto", "font-size": "12px", "flex": "1" }} value={slot.modelId || ""} onChange={(e) => bindSlot(slot.slotKey, e.currentTarget.value, slot.backupModelId)}>
                  <option value="">未绑定</option>
                  <For each={allModels}>{(m: any) => <option value={m.id}>{m.id}</option>}</For>
                </select>
              </div>
              <div class="slot-binding">
                <span class="slot-label">备用</span>
                <select class="field" style={{ width: "auto", "font-size": "12px", "flex": "1" }} value={slot.backupModelId || ""} onChange={(e) => bindSlot(slot.slotKey, slot.modelId, e.currentTarget.value)}>
                  <option value="">无</option>
                  <For each={allModels}>{(m: any) => <option value={m.id}>{m.id}</option>}</For>
                </select>
              </div>
            </div>
          );
        }}</For>
      </Show>
    </div>
  );
}
