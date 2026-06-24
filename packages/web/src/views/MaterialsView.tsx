/** web/src/views/MaterialsView.tsx — 素材库（分类筛选 + 可复用图+prompt + 点击放大） */
import { createSignal, For, Show, onMount, createMemo } from "solid-js";

const CATEGORIES = [
  { key: "", label: "全部", icon: "📁" },
  { key: "product", label: "产品", icon: "📦" },
  { key: "character", label: "人物", icon: "👤" },
  { key: "scene", label: "场景", icon: "🏞️" },
];

export default function MaterialsView() {
  const [materials, setMaterials] = createSignal<Array<any>>([]);
  const [activeCategory, setActiveCategory] = createSignal("");
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);

  const load = async () => { try { setMaterials(await fetch("/api/materials").then((r) => r.json())); } catch {} };
  onMount(load);

  const del = async (mid: string) => { await fetch(`/api/materials/${mid}`, { method: "DELETE" }); await load(); };

  const filtered = createMemo(() => {
    const cat = activeCategory();
    if (!cat) return materials();
    return materials().filter((m) => m.category === cat);
  });

  const countMap = createMemo(() => {
    const map: Record<string, number> = { "": materials().length };
    for (const m of materials()) {
      const c = m.category || "uncategorized";
      map[c] = (map[c] || 0) + 1;
    }
    return map;
  });

  return (
    <div class="view-page">
      <h1 class="font-display">素材库</h1>
      <div class="hint" style={{ "margin-bottom": "16px" }}>可复用的场景、人物和产品素材，生图时自动匹配</div>

      <div class="material-tabs">
        <For each={CATEGORIES}>{(cat) => (
          <span
            class={`material-tab ${activeCategory() === cat.key ? "active" : ""}`}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.icon} {cat.label}
            <Show when={countMap()[cat.key]}>
              <span class="tab-count">{countMap()[cat.key]}</span>
            </Show>
          </span>
        )}</For>
      </div>

      <Show when={filtered().length === 0}>
        <div style={{ color: "var(--fg-mute)", "text-align": "center", padding: "40px" }}>
          {activeCategory() ? "该分类暂无素材" : "暂无素材"}
        </div>
      </Show>

      <div class="media-grid">
        <For each={filtered()}>{(m) => (
          <div class="media-card">
            <img src={m.url} alt={m.name} onClick={() => setLightboxUrl(m.url)} style={{ cursor: "zoom-in" }} />
            <div style={{ padding: "8px 10px" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "4px" }}>
                <span style={{ "font-size": "13px", "font-weight": 500, flex: "1" }}>{m.name}</span>
                <Show when={m.category}>
                  <span class="material-category-tag">{m.category === "product" ? "产品" : m.category === "character" ? "人物" : m.category === "scene" ? "场景" : m.category}</span>
                </Show>
              </div>
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

      {/* 放大查看弹窗 */}
      <Show when={lightboxUrl()}>
        <div class="lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl()!} class="lightbox-img" alt="" />
          <div class="lightbox-hint">点击任意处关闭</div>
        </div>
      </Show>
    </div>
  );
}
