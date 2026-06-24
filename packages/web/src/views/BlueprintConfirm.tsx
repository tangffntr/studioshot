/**
 * web/src/views/BlueprintConfirm.tsx — 页面规划确认组件
 * 展示8屏详情页规划，用户可确认或拒绝
 */
import { createSignal, Show, For } from "solid-js";
import { state, approveBlueprint, rejectBlueprint } from "../context/store";
import type { PageBlueprint, ScreenPlan } from "@ecom/shared";

export default function BlueprintConfirm() {
  const [feedback, setFeedback] = createSignal("");
  const [showFeedback, setShowFeedback] = createSignal(false);
  const [expandedScreen, setExpandedScreen] = createSignal<string | null>(null);

  const blueprint = () => state.pendingBlueprint;

  const handleApprove = () => {
    approveBlueprint(feedback() || undefined);
    setFeedback("");
    setShowFeedback(false);
  };

  const handleReject = () => {
    if (!feedback().trim()) {
      setShowFeedback(true);
      return;
    }
    rejectBlueprint(feedback());
    setFeedback("");
    setShowFeedback(false);
  };

  const toggleScreen = (sliceId: string) => {
    setExpandedScreen(expandedScreen() === sliceId ? null : sliceId);
  };

  const getDensityColor = (density: string) => {
    switch (density) {
      case "high": return "var(--accent)";
      case "medium": return "var(--fg-dim)";
      case "low": return "var(--fg-mute)";
      default: return "var(--fg-dim)";
    }
  };

  const getScreenIcon = (moduleType: string) => {
    const icons: Record<string, string> = {
      hero: "🏠",
      benefit: "✨",
      mechanism: "⚙️",
      function: "🔧",
      detail: "🔍",
      scenario: "🎯",
      proof: "📋",
      comparison: "⚖️",
      closing: "🛒",
    };
    return icons[moduleType] || "📄";
  };

  return (
    <Show when={blueprint()}>
      <div class="blueprint-confirm">
        <div class="blueprint-header">
          <div class="blueprint-title">
            <span class="blueprint-icon">📋</span>
            <h3>页面规划</h3>
          </div>
          <div class="blueprint-meta">
            <span class="blueprint-product">{blueprint()!.productName}</span>
            <span class="blueprint-category">{blueprint()!.productCategory}</span>
          </div>
        </div>

        {/* 卖点种子 */}
        <div class="blueprint-seeds">
          <h4>核心卖点</h4>
          <div class="seed-tags">
            <For each={blueprint()!.claimSeeds}>
              {(seed) => <span class="seed-tag">{seed}</span>}
            </For>
          </div>
        </div>

        {/* 8屏规划 */}
        <div class="blueprint-screens">
          <h4>8屏规划</h4>
          <For each={blueprint()!.screens}>
            {(screen: ScreenPlan) => (
              <div
                class={`screen-card ${expandedScreen() === screen.sliceId ? "expanded" : ""}`}
                onClick={() => toggleScreen(screen.sliceId)}
              >
                <div class="screen-header">
                  <div class="screen-id">
                    <span class="screen-number">{screen.sliceId}</span>
                    <span class="screen-icon">{getScreenIcon(screen.moduleType)}</span>
                  </div>
                  <div class="screen-info">
                    <div class="screen-question">{screen.buyerQuestion}</div>
                    <div class="screen-job">{screen.screenJob}</div>
                  </div>
                  <div class="screen-density" style={{ color: getDensityColor(screen.contentDensity) }}>
                    {screen.contentDensity}
                  </div>
                </div>

                <Show when={expandedScreen() === screen.sliceId}>
                  <div class="screen-details">
                    <div class="detail-row">
                      <span class="detail-label">卖点种子：</span>
                      <span class="detail-value">{screen.claimSeed}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">文案结构：</span>
                      <span class="detail-value">{screen.copyStructurePattern}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">证据类型：</span>
                      <span class="detail-value">{screen.evidenceType}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">构图变化：</span>
                      <span class="detail-value">{screen.compositionShift}</span>
                    </div>
                    <Show when={screen.textExact.headline}>
                      <div class="detail-row">
                        <span class="detail-label">标题：</span>
                        <span class="detail-value">{screen.textExact.headline}</span>
                      </div>
                    </Show>
                    <Show when={screen.textExact.subheadline}>
                      <div class="detail-row">
                        <span class="detail-label">副标题：</span>
                        <span class="detail-value">{screen.textExact.subheadline}</span>
                      </div>
                    </Show>
                    <Show when={screen.textExact.tags && screen.textExact.tags.length > 0}>
                      <div class="detail-row">
                        <span class="detail-label">标签：</span>
                        <div class="detail-tags">
                          <For each={screen.textExact.tags}>
                            {(tag) => <span class="detail-tag">{tag}</span>}
                          </For>
                        </div>
                      </div>
                    </Show>
                    <Show when={screen.textExact.cta}>
                      <div class="detail-row">
                        <span class="detail-label">行动号召：</span>
                        <span class="detail-value">{screen.textExact.cta}</span>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        {/* 风险评估 */}
        <Show when={blueprint()!.riskAssessment.length > 0}>
          <div class="blueprint-risks">
            <h4>风险提示</h4>
            <For each={blueprint()!.riskAssessment}>
              {(risk) => <div class="risk-item">⚠️ {risk}</div>}
            </For>
          </div>
        </Show>

        {/* 反馈输入 */}
        <Show when={showFeedback()}>
          <div class="blueprint-feedback">
            <textarea
              value={feedback()}
              onInput={(e) => setFeedback(e.currentTarget.value)}
              placeholder="请输入修改建议（拒绝时必填）..."
              rows={3}
            />
          </div>
        </Show>

        {/* 操作按钮 */}
        <div class="blueprint-actions">
          <button class="btn btn-primary" onClick={handleApprove}>
            ✅ 确认规划
          </button>
          <button class="btn btn-ghost" onClick={handleReject}>
            ❌ 拒绝并修改
          </button>
        </div>
      </div>
    </Show>
  );
}
