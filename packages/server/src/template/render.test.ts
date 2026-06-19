import { describe, it, expect } from "vitest";
import { renderPrompt, renderAllSlots, type ProductAttributes } from "./render";
import type { TemplateSlot } from "@ecom/shared";

describe("renderPrompt", () => {
  it("替换 {color}{category}{material} 占位", () => {
    const skeleton = "A {color} {category} made of {material}";
    const attrs: ProductAttributes = { color: "red", category: "mug", material: "ceramic" };
    expect(renderPrompt(skeleton, attrs)).toBe("A red mug made of ceramic");
  });

  it("缺失属性用兜底值", () => {
    const skeleton = "A {color} {category}";
    expect(renderPrompt(skeleton, {})).toBe("A neutral product");
  });

  it("空字符串属性也用兜底", () => {
    const skeleton = "{color} item";
    expect(renderPrompt(skeleton, { color: "  " })).toBe("neutral item");
  });

  it("未知占位用 product 兜底", () => {
    const skeleton = "A {unknownKey} here";
    expect(renderPrompt(skeleton, {})).toBe("A product here");
  });

  it("无占位的骨架原样返回", () => {
    expect(renderPrompt("plain text no vars", {})).toBe("plain text no vars");
  });
});

describe("renderAllSlots", () => {
  const mockSlots: TemplateSlot[] = [
    {
      id: "s1", templateId: "t1", slotCode: "H1", purpose: "hero", sequence: 1,
      sceneType: "hero", sizePreset: "1024x1024", taskSlotKey: "main-image",
      promptSkeleton: "white bg {color} {category}", required: true, notes: null,
    },
    {
      id: "s2", templateId: "t1", slotCode: "D1", purpose: "detail", sequence: 6,
      sceneType: "infographic", sizePreset: "1024x1536", taskSlotKey: "detail-page",
      promptSkeleton: "detail page for {category} {material}", required: true, notes: null,
    },
  ];

  it("渲染全部图位，保留 slot 元信息", () => {
    const attrs: ProductAttributes = { color: "blue", category: "bottle", material: "glass" };
    const rendered = renderAllSlots(mockSlots, attrs);
    expect(rendered).toHaveLength(2);
    expect(rendered[0].prompt).toBe("white bg blue bottle");
    expect(rendered[0].size).toBe("1024x1024");
    expect(rendered[0].slot.slotCode).toBe("H1");
    expect(rendered[1].prompt).toBe("detail page for bottle glass");
    expect(rendered[1].size).toBe("1024x1536");
  });

  it("sizePreset 为空时兜底 1024x1024", () => {
    const slotNoSize: TemplateSlot[] = [{
      ...mockSlots[0], sizePreset: null,
    } as any];
    const rendered = renderAllSlots(slotNoSize, {});
    expect(rendered[0].size).toBe("1024x1024");
  });
});
