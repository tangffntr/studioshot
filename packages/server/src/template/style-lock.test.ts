import { describe, it, expect } from "vitest";
import { generateStyleLock, applyStyleLock } from "./style-lock";

describe("generateStyleLock", () => {
  it("含色板/光线/布局关键元素", () => {
    const lock = generateStyleLock({ color: "red", category: "mug" });
    expect(lock).toContain("[STYLE LOCK:");
    expect(lock).toContain("red");
    expect(lock.toLowerCase()).toContain("lighting");
    expect(lock.toLowerCase()).toContain("composition");
  });

  it("平台影响冷暖调", () => {
    const taobao = generateStyleLock({ color: "blue" }, "taobao");
    const amazon = generateStyleLock({ color: "blue" }, "amazon");
    expect(taobao).toContain("Warm tone");
    expect(amazon).toContain("Neutral to cool");
  });

  it("缺属性用 neutral 兜底", () => {
    const lock = generateStyleLock({});
    expect(lock).toContain("neutral");
  });
});

describe("applyStyleLock", () => {
  it("把 lock 注入到每个 prompt 开头", () => {
    const rendered = [{ prompt: "a mug" }, { prompt: "a bottle" }];
    const lock = "[STYLE LOCK: test] ";
    applyStyleLock(rendered, lock);
    expect(rendered[0].prompt).toBe("[STYLE LOCK: test] a mug");
    expect(rendered[1].prompt).toBe("[STYLE LOCK: test] a bottle");
  });

  it("已有 lock 不重复注入", () => {
    const rendered = [{ prompt: "[STYLE LOCK: existing] old" }];
    applyStyleLock(rendered, "[STYLE LOCK: new] ");
    expect(rendered[0].prompt).toBe("[STYLE LOCK: existing] old");
  });
});
