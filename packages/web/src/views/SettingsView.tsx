/** web/src/views/SettingsView.tsx — 模型设置 */
import { createSignal, For, Show, onMount } from "solid-js";

export default function SettingsView() {
  const [settings, setSettings] = createSignal<any>(null);
  const [editVendor, setEditVendor] = createSignal<string | null>(null);
  const [credInputs, setCredInputs] = createSignal<Record<string, string>>({});
  const [savedMsg, setSavedMsg] = createSignal("");

  const load = async () => { try { setSettings(await fetch("/api/settings").then((r) => r.json())); } catch {} };
  onMount(load);
  const startEdit = (v: any) => { setEditVendor(v.id); const i: Record<string, string> = {}; v.inputs.forEach((x: any) => { i[x.key] = v.baseUrl && x.key === "baseUrl" ? v.baseUrl : ""; }); setCredInputs(i); setSavedMsg(""); };
  const saveCreds = async (id: string) => { await fetch("/api/settings/credentials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendorId: id, values: credInputs() }) }); setEditVendor(null); setSavedMsg(`${id} 已保存`); await load(); };
  const bindSlot = async (k: string, m: string) => { await fetch("/api/settings/task-slot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slotKey: k, modelId: m }) }); setSavedMsg(`${k} 已绑定`); await load(); };

  return (
    <div class="view-page">
      <h1 class="font-display">模型设置</h1>
      <Show when={savedMsg()}><div class="saved-msg">✓ {savedMsg()}</div></Show>
      <Show when={settings()}>
        <div class="vendor-grid">
          <For each={settings().vendors || []}>{(v: any) => (
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
          )}</For>
        </div>
        <div class="divider-label" style={{ "margin-top": "24px" }}>任务槽绑定</div>
        <For each={settings().taskSlots || []}>{(slot: any) => {
          const allModels = (settings().vendors || []).flatMap((v: any) => v.models);
          return (
            <div class="slot-row">
              <span class="slot-key">{slot.slotKey}</span>
              <select class="field" style={{ width: "auto", "font-size": "12px" }} value={slot.modelId || ""} onChange={(e) => bindSlot(slot.slotKey, e.currentTarget.value)}>
                <For each={allModels}>{(m: any) => <option value={m.id}>{m.id}</option>}</For>
              </select>
            </div>
          );
        }}</For>
      </Show>
    </div>
  );
}
