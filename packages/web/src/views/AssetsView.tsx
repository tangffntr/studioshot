/** web/src/views/AssetsView.tsx — 资产库（图片 + 视频 + 点击放大） */
import { createSignal, For, Show, onMount } from "solid-js";

export default function AssetsView() {
  const [media, setMedia] = createSignal<Array<any>>([]);
  const [confirmDel, setConfirmDel] = createSignal<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);

  const loadMedia = async () => {
    const all = await fetch("/api/media").then((r) => r.json());
    // 显示图片和视频类型，排除素材库来源
    const assets = all.filter((m: any) => (m.type === "image" || m.type === "video") && !m.sourceMediaId);
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
      <span class="hint" style={{ "margin-bottom": "20px", display: "block" }}>{media().length} 项 · 显示所有任务产出的图片和视频</span>
      <Show when={media().length === 0} fallback={
        <div class="media-grid">
          <For each={media()}>{(m) => (
            <div class="media-card">
              {/* 视频用 video 标签，图片用 img 标签 */}
              <Show when={m.type === "video"} fallback={
                <img src={m.url} alt="" onClick={() => setLightboxUrl(m.url)} style={{ cursor: "zoom-in" }} />
              }>
                <video
                  src={m.url}
                  muted
                  loop
                  playsinline
                  preload="metadata"
                  style={{ width: "100%", height: "140px", "object-fit": "cover", display: "block", background: "#000", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                  onClick={() => setLightboxUrl(m.url)}
                />
                <span class="video-badge">▶ 视频</span>
              </Show>
              <div class="media-meta">
                <Show when={m.slotCode}><span class="slot-badge">{m.slotCode}</span></Show>
                <Show when={m.duration}><span class="hint">{m.duration}s</span></Show>
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
        <div class="hint">暂无任务产出。完成出图任务后，生成的图片和视频会出现在这里。</div>
      </Show>

      {/* 放大查看弹窗（图片 + 视频） */}
      <Show when={lightboxUrl()}>
        <div class="lightbox" onClick={() => setLightboxUrl(null)}>
          <Show when={lightboxUrl()!.endsWith(".mp4") || lightboxUrl()!.includes("/video/")} fallback={
            <img src={lightboxUrl()!} class="lightbox-img" alt="" />
          }>
            <video
              src={lightboxUrl()!}
              controls
              autoplay
              loop
              style={{ "max-width": "90vw", "max-height": "85vh", "border-radius": "8px" }}
              onClick={(e) => e.stopPropagation()}
            />
          </Show>
          <div class="lightbox-hint">点击任意处关闭</div>
        </div>
      </Show>
    </div>
  );
}
