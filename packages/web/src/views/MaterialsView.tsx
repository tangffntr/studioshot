/** web/src/views/MaterialsView.tsx — 素材库（可复用图+prompt） */
import { createSignal, For, Show, onMount } from "solid-js";

export default function MaterialsView() {
  const [materials, setMaterials] = createSignal<Array<any>>([]);

  const load = async () => { try { setMaterials(await fetch("/api/materials").then((r) => r.json())); } catch {} };
  onMount(load);

  const del = async (mid: string) => { await fetch(`/api/materials/${mid}`, { method: "DELETE" }); await load(); };

  return (
    <div class="view-page">
      <h1 class="font-display">素材库</h1>
      <div class="hint" style={{ "margin-bottom": "20px" }}>从资产库「存为素材」的可复用图片，含生成 prompt</div>
      <Show when={materials().length === 0}>
        <div style={{ color: "var(--fg-mute)", "text-align": "center", padding: "40px" }}>暂无素材。在资产库中点击「存为素材」添加。</div>
      </Show>
      <div class="media-grid">
        <For each={materials()}>{(m) => (
          <div class="media-card">
            <img src={m.url} alt={m.name} />
            <div style={{ padding: "8px 10px" }}>
              <div style={{ "font-size": "13px", "font-weight": 500, "margin-bottom": "4px" }}>{m.name}</div>
              <Show when={m.promptText}>
                <div class="hint" style={{ "margin-bottom": "6px", "max-height": "40px", overflow: "hidden" }}>{m.promptText}</div>
              </Show>
              <div class="media-actions">
                <a href={m.url} download="">下载</a>
                <a class="danger" onClick={(e) => { e.preventDefault(); del(m.id); }}>删除</a>
              </div>
            </div>
          </div>
        )}</For>
      </div>
    </div>
  );
}
