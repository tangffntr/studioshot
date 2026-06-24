import { describe, it, expect } from "vitest";
import { generateStyleLock, applyStyleLock } from "./style-lock";

describe("generateStyleLock", () => {
  it("含色板/光线/布局关键元素", () => {
    const lock = generateStyleLock({ color: "红色", category: "马克杯" });
    expect(lock).toContain("[风格锁定：");
    expect(lock).toContain("红色");
    expect(lock).toContain("光");
    expect(lock).toContain("构图");
  });

  it("平台影响冷暖调", () => {
    const taobao = generateStyleLock({ color: "蓝色" }, "taobao");
    const amazon = generateStyleLock({ color: "蓝色" }, "amazon");
    expect(taobao).toContain("暖色调");
    expect(amazon).toContain("中性偏冷色调");
  });

  it("缺属性用中性色兜底", () => {
    const lock = generateStyleLock({});
    expect(lock).toContain("中性色");
  });
});

describe("applyStyleLock", () => {
  it("把 lock 注入到每个 prompt 开头", () => {
    const rendered = [{ prompt: "一个马克杯" }, { prompt: "一个水杯" }];
    const lock = "[风格锁定：测试] ";
    applyStyleLock(rendered, lock);
    expect(rendered[0].prompt).toBe("[风格锁定：测试] 一个马克杯");
    expect(rendered[1].prompt).toBe("[风格锁定：测试] 一个水杯");
  });

  it("已有 lock 不重复注入", () => {
    const rendered = [{ prompt: "[风格锁定：已存在] 旧的" }];
    applyStyleLock(rendered, "[风格锁定：新的] ");
    expect(rendered[0].prompt).toBe("[风格锁定：已存在] 旧的");
  });
});
