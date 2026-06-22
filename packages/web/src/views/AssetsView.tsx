/** web/src/views/AssetsView.tsx — 资产库（全部任务产出，不依赖 productId） */
import { createSignal, For, Show, onMount } from "solid-js";

export default function AssetsView() {
  const [media, setMedia] = createSignal<Array<any>>([]);
  const [confirmDel, setConfirmDel] = createSignal<string | null>(null);

  const loadMedia = async () => {
    // 查全量 media，按创建时间倒序
    const all = await fetch("/api/media").then((r) => r.json());
    // 排除素材库来源（sourceMediaId 非空 = 从资产转存的，不是任务产出）
    // 且只显示 image 类型
    const assets = all.filter((m: any) => m.type === "image" && !m.sourceMediaId);
    setMedia(assets);
  };

  const del = async (mid: string) => {
    await fetch(`/api/media/${mid}`, { method: "DELETE" });
    setConfirmDel(null);
    await loadMedia();
  };

  const saveAsMaterial = async (m: any) => {
    await fetch("/api/materials", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceMediaId: m.id, name: m.slotCode ? `${m.slotCode} 素材` : "资产素材", promptText: m.promptText }),
    });
    alert("已存为素材");
  };

  onMount(() => { loadMedia(); setInterval(loadMedia, 5000); });

  return (
    <div class="view-page">
      <h1 class="font-display">资产库</h1>
      <span class="hint" style={{ "margin-bottom": "20px", display: "block" }}>{media().length} 项 · 显示所有任务产出的图片</span>
      <Show when={media().length === 0} fallback={
        <div class="media-grid">
          <For each={media()}>{(m) => (
            <div class="media-card">
              <img src={m.url} alt="" />
              <div class="media-meta">
                <Show when={m.slotCode}><span class="slot-badge">{m.slotCode}</span></Show>
                <Show when={m.sortOrder}><span class="hint">#{m.sortOrder}</span></Show>
              </div>
              <Show when={m.promptText}>
                <div class="hint" style={{ padding: "0 10px", "max-height": "36px", overflow: "hidden", "font-size": "10px" }}>{m.promptText?.slice(0, 80)}</div>
              </Show>
              <div class="media-actions" style={{ padding: "6px 10px 8px" }}>
                <a href={m.url} download="">下载</a>
                <a onClick={(e) => { e.preventDefault(); saveAsMaterial(m); }}>存为素材</a>
                <Show when={confirmDel() === m.id} fallback={
                  <a class="danger" onClick={(e) => { e.preventDefault(); setConfirmDel(m.id); }}>删除</a>
                }>
                  <a class="danger" onClick={(e) => { e.preventDefault(); del(m.id); }}>确认</a>
                  <a onClick={(e) => { e.preventDefault(); setConfirmDel(null); }}>取消</a>
                </Show>
              </div>
            </div>
          )}</For>
        </div>
      }>
        <div class="hint">暂无任务产出。完成出图任务后，生成的图片会出现在这里。</div>
      </Show>
    </div>
  );
}
