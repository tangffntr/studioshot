/** web/src/views/SettingsView.tsx — 完整模型配置（apiKey + baseUrl + 模型增删 + 任务槽） */
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

  const bindSlot = async (k: string, m: string) => {
    await fetch("/api/settings/task-slot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotKey: k, modelId: m }) });
    setSavedMsg(`${k} 已绑定`);
    await load();
  };

  return (
    <div class="view-page">
      <h1 class="font-display">模型设置</h1>
      <Show when={savedMsg()}><div class="saved-msg">✓ {savedMsg()}</div></Show>

      <Show when={settings()}>
        <div class="divider-label">供应商配置</div>
        <div class="vendor-grid">
          <For each={settings().vendors || []}>{(v: any) => (
            <div class="vendor-card">
              <div class="vendor-name">{v.name}</div>
              <div class="vendor-meta">{v.id} · {v.adapter}</div>

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
                    <option value="image">image</option>
                    <option value="video">video</option>
                    <option value="vlm">vlm</option>
                    <option value="tryon">tryon</option>
                  </select>
                  <button class="btn btn-primary btn-sm" onClick={() => addModel(v.id)}>添加</button>
                </div>
              </Show>

              {/* 模型列表 */}
              <div style={{ "margin-top": "8px" }}>
                <For each={v.models}>{(m: any) => (
                  <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "font-size": "11px", "font-family": "JetBrains Mono, monospace", color: "var(--fg-dim)", "margin-bottom": "2px" }}>
                    <span>{m.modelName}</span>
                    <a class="danger" style={{ "font-size": "10px", color: "var(--danger)", cursor: "pointer" }} onClick={() => delModel(m.id)}>✕</a>
                  </div>
                )}</For>
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
              <select class="field" style={{ width: "auto", "font-size": "12px" }} value={slot.modelId || ""} onChange={(e) => bindSlot(slot.slotKey, e.currentTarget.value)}>
                <option value="">未绑定</option>
                <For each={allModels}>{(m: any) => <option value={m.id}>{m.id}</option>}</For>
              </select>
            </div>
          );
        }}</For>
      </Show>
    </div>
  );
}
