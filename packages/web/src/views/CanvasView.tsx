/**
 * web/src/views/CanvasView.tsx — 画布视图
 * 左侧资产选择 + 中间画布区域 + 底部提示词编辑
 */
import { createSignal, For, Show, onMount } from "solid-js";
import { state, addCanvasItem, updateCanvasItemPosition, selectCanvasItem, removeCanvasItem, updateCanvasItemPrompt } from "../context/store";
import type { CanvasItem } from "../context/store";

export default function CanvasView() {
  const [assets, setAssets] = createSignal<Array<any>>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [canvasScale, setCanvasScale] = createSignal(1);
  const [canvasOffset, setCanvasOffset] = createSignal({ x: 0, y: 0 });
  const [isDraggingCanvas, setIsDraggingCanvas] = createSignal(false);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });
  const [editingPrompt, setEditingPrompt] = createSignal(false);
  const [draftPrompt, setDraftPrompt] = createSignal("");
  const [regenerating, setRegenerating] = createSignal(false);
  const [lightboxUrl, setLightboxUrl] = createSignal<string | null>(null);

  let canvasRef: HTMLDivElement | undefined;

  // 加载资产列表
  const loadAssets = async () => {
    try {
      const all = await fetch("/api/media").then((r) => r.json());
      const filtered = all.filter((m: any) => m.type === "image" && !m.sourceMediaId);
      setAssets(filtered);
    } catch (e) {
      console.error("加载资产失败", e);
    }
  };

  onMount(() => {
    loadAssets();
    // 每10秒刷新资产列表
    setInterval(loadAssets, 10000);
  });

  // 搜索过滤资产
  const filteredAssets = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return assets();
    return assets().filter((m: any) =>
      m.promptText?.toLowerCase().includes(query) ||
      m.slotCode?.toLowerCase().includes(query)
    );
  };

  // 添加资产到画布
  const addToCanvas = (media: any) => {
    addCanvasItem({
      id: media.id,
      url: media.url,
      promptText: media.promptText,
    });
  };

  // 选中的画布项目
  const selectedItem = () => {
    if (!state.selectedCanvasItemId) return null;
    return state.canvasItems.find((item) => item.id === state.selectedCanvasItemId) || null;
  };

  // 开始编辑提示词
  const startEditPrompt = () => {
    const item = selectedItem();
    if (item) {
      setDraftPrompt(item.promptText || "");
      setEditingPrompt(true);
    }
  };

  // 保存提示词
  const savePrompt = async () => {
    const item = selectedItem();
    if (!item) return;

    try {
      // 更新后端
      await fetch(`/api/media/${item.mediaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: draftPrompt() }),
      });

      // 更新前端状态
      updateCanvasItemPrompt(item.id, draftPrompt());
      setEditingPrompt(false);
    } catch (e) {
      console.error("保存提示词失败", e);
    }
  };

  // 重新生成图片
  const regenerate = async () => {
    const item = selectedItem();
    if (!item) return;

    const prompt = editingPrompt() ? draftPrompt() : (item.promptText || "");
    if (!prompt) return;

    setRegenerating(true);
    try {
      // 先保存修改的提示词
      if (editingPrompt()) {
        await savePrompt();
      }

      // 提交新任务
      const job = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: prompt,
          mode: "agent",
        }),
      }).then((r) => r.json());

      // 监听任务完成，自动添加到画布
      const checkJob = async () => {
        try {
          const jobStatus = await fetch(`/api/jobs/${job.jobId}`).then((r) => r.json());
          if (jobStatus.status === "done") {
            // 获取生成的图片
            const mediaList = await fetch(`/api/media?jobId=${job.jobId}`).then((r) => r.json());
            if (mediaList.length > 0) {
              const newMedia = mediaList[0];
              addCanvasItem({
                id: newMedia.id,
                url: newMedia.url,
                promptText: newMedia.promptText,
              });
            }
            setRegenerating(false);
            return;
          }
          if (jobStatus.status === "failed") {
            console.error("生成失败", jobStatus.error);
            setRegenerating(false);
            return;
          }
          // 继续轮询
          setTimeout(checkJob, 1000);
        } catch (e) {
          console.error("检查任务状态失败", e);
          setRegenerating(false);
        }
      };

      checkJob();
    } catch (e) {
      console.error("重新生成失败", e);
      setRegenerating(false);
    }
  };

  // 画布缩放
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(3, canvasScale() + delta));
    setCanvasScale(newScale);
  };

  // 画布拖拽开始
  const handleCanvasMouseDown = (e: MouseEvent) => {
    if (e.target === canvasRef || (e.target as HTMLElement).classList.contains("canvas-area")) {
      setIsDraggingCanvas(true);
      setDragStart({ x: e.clientX - canvasOffset().x, y: e.clientY - canvasOffset().y });
      // 取消选中
      selectCanvasItem(null);
    }
  };

  // 画布拖拽中
  const handleCanvasMouseMove = (e: MouseEvent) => {
    if (isDraggingCanvas()) {
      setCanvasOffset({
        x: e.clientX - dragStart().x,
        y: e.clientY - dragStart().y,
      });
    }
  };

  // 画布拖拽结束
  const handleCanvasMouseUp = () => {
    setIsDraggingCanvas(false);
  };

  // 图片拖拽开始
  const handleItemMouseDown = (e: MouseEvent, item: CanvasItem) => {
    e.stopPropagation();
    selectCanvasItem(item.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = item.x;
    const startPosY = item.y;

    const handleMouseMove = (moveE: MouseEvent) => {
      const deltaX = (moveE.clientX - startX) / canvasScale();
      const deltaY = (moveE.clientY - startY) / canvasScale();
      updateCanvasItemPosition(item.id, startPosX + deltaX, startPosY + deltaY);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // 删除选中的画布项目
  const deleteSelected = () => {
    if (state.selectedCanvasItemId) {
      removeCanvasItem(state.selectedCanvasItemId);
    }
  };

  // 键盘快捷键
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelected();
    }
    if (e.key === "Escape") {
      selectCanvasItem(null);
      setEditingPrompt(false);
    }
  };

  return (
    <div class="canvas-view" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* 左侧资产面板 */}
      <aside class="canvas-assets-panel">
        <div class="canvas-assets-header">
          <h3 class="font-display">资产库</h3>
          <span class="hint">{filteredAssets().length} 项</span>
        </div>
        <input
          type="text"
          class="canvas-search-input"
          placeholder="搜索资产..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
        <div class="canvas-assets-grid">
          <For each={filteredAssets()}>{(media) => (
            <div class="canvas-asset-item" onClick={() => addToCanvas(media)}>
              <img src={media.url} alt="" />
              <Show when={media.slotCode}>
                <span class="slot-badge">{media.slotCode}</span>
              </Show>
            </div>
          )}</For>
        </div>
      </aside>

      {/* 中间画布区域 */}
      <div class="canvas-container">
        <div class="canvas-toolbar">
          <span class="hint">缩放: {(canvasScale() * 100).toFixed(0)}%</span>
          <button class="btn btn-ghost btn-sm" onClick={() => setCanvasScale(1)}>重置缩放</button>
          <button class="btn btn-ghost btn-sm" onClick={() => setCanvasOffset({ x: 0, y: 0 })}>重置位置</button>
          <Show when={state.selectedCanvasItemId}>
            <button class="btn btn-ghost btn-sm" onClick={deleteSelected}>删除选中</button>
          </Show>
        </div>
        <div class="canvas-main-area">
          <div
            ref={canvasRef}
            class="canvas-area"
            style={{
              transform: `translate(${canvasOffset().x}px, ${canvasOffset().y}px) scale(${canvasScale()})`,
              "transform-origin": "0 0",
            }}
            onWheel={handleWheel}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          >
            <For each={state.canvasItems}>{(item) => (
              <div
                class={`canvas-item ${state.selectedCanvasItemId === item.id ? "selected" : ""}`}
                style={{
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                }}
                onMouseDown={(e) => handleItemMouseDown(e, item)}
              >
                <img
                  src={item.url}
                  alt=""
                  onDblClick={() => setLightboxUrl(item.url)}
                />
                <Show when={item.promptText}>
                  <div class="canvas-item-prompt">{item.promptText?.slice(0, 50)}...</div>
                </Show>
              </div>
            )}</For>
          </div>
        </div>

        {/* 底部提示词编辑面板 */}
        <Show when={selectedItem()}>
          <div class="canvas-prompt-panel">
            <div class="canvas-prompt-header">
              <span class="font-display">提示词编辑</span>
              <div class="canvas-prompt-actions">
                <Show when={!editingPrompt()}>
                  <button class="btn btn-ghost btn-sm" onClick={startEditPrompt}>编辑</button>
                </Show>
                <Show when={editingPrompt()}>
                  <button class="btn btn-primary btn-sm" onClick={savePrompt}>保存</button>
                  <button class="btn btn-ghost btn-sm" onClick={() => setEditingPrompt(false)}>取消</button>
                </Show>
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={regenerate}
                  disabled={regenerating()}
                >
                  {regenerating() ? "⏳ 生成中..." : "🔄 重新生成"}
                </button>
              </div>
            </div>
          <Show when={editingPrompt()} fallback={
            <div class="canvas-prompt-content" onClick={startEditPrompt}>
              {selectedItem()?.promptText || "(无提示词，点击编辑)"}
            </div>
          }>
            <textarea
              class="canvas-prompt-edit"
              value={draftPrompt()}
              onInput={(e) => setDraftPrompt(e.currentTarget.value)}
              rows={4}
              placeholder="输入提示词..."
            />
          </Show>
        </div>
      </Show>
      </div>

      {/* Lightbox */}
      <Show when={lightboxUrl()}>
        <div class="lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl()!} class="lightbox-img" alt="" />
          <div class="lightbox-hint">点击任意处关闭</div>
        </div>
      </Show>
    </div>
  );
}
