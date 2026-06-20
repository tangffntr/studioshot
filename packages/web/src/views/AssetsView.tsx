/** web/src/views/AssetsView.tsx — 资产库（媒体画廊） */
import { createSignal, For, Show, onMount } from "solid-js";

export default function AssetsView() {
  const [products, setProducts] = createSignal<Array<{ id: string; name: string }>>([]);
  const [selProduct, setSelProduct] = createSignal("");
  const [media, setMedia] = createSignal<Array<any>>([]);
  const [confirmDel, setConfirmDel] = createSignal<string | null>(null);

  const loadProducts = async () => {
    const r = await fetch("/api/products").then((r) => r.json());
    setProducts(r);
    if (r.length && !selProduct()) { setSelProduct(r[0].id); await loadMedia(r[0].id); }
    else if (selProduct()) await loadMedia(selProduct());
  };
  const loadMedia = async (pid: string) => { setMedia(await fetch(`/api/media?productId=${pid}`).then((r) => r.json())); };
  const del = async (mid: string) => { await fetch(`/api/media/${mid}`, { method: "DELETE" }); setConfirmDel(null); await loadMedia(selProduct()); };
  onMount(() => { loadProducts(); setInterval(loadProducts, 5000); });

  return (
    <div class="view-page">
      <h1 class="font-display">资产库</h1>
      <div style={{ display: "flex", gap: "10px", "align-items": "center", "margin-bottom": "20px" }}>
        <select class="field" style={{ width: "auto" }} value={selProduct()} onChange={async (e) => { setSelProduct(e.currentTarget.value); await loadMedia(e.currentTarget.value); }}>
          <For each={products()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <span class="hint">{media().length} 项</span>
      </div>
      <Show when={media().length === 0} fallback={
        <div class="media-grid">
          <For each={media()}>{(m) => (
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
                  <a class="danger" onClick={(e) => { e.preventDefault(); del(m.id); }}>确认</a>
                  <a onClick={(e) => { e.preventDefault(); setConfirmDel(null); }}>取消</a>
                </Show>
              </div>
            </div>
          )}</For>
        </div>
      }>
        <div class="hint">该产品暂无素材</div>
      </Show>
    </div>
  );
}
