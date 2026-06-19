import { describe, it, expect, vi } from "vitest";
import { withRetry, isRetryableError } from "./retry";

describe("isRetryableError", () => {
  it("网络/超时/限流错误可重试", () => {
    expect(isRetryableError(new Error("network error"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("timeout"))).toBe(true);
    expect(isRetryableError(new Error("429 rate limit"))).toBe(true);
    expect(isRetryableError(new Error("502 bad gateway"))).toBe(true);
  });

  it("参数/认证错误不重试", () => {
    expect(isRetryableError(new Error("Param Incorrect"))).toBe(false);
    expect(isRetryableError(new Error("401 unauthorized"))).toBe(false);
    expect(isRetryableError(new Error("model not found"))).toBe(false);
    expect(isRetryableError(new Error("InvalidParameter"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("成功则不重试", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const r = await withRetry(fn);
    expect(r).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("可重试错误重试到成功", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce("ok");
    const r = await withRetry(fn, 2, 10); // 短延迟测试
    expect(r).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("不可重试错误立即抛出", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Param Incorrect"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("Param Incorrect");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("超过重试次数后抛出", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("503 service unavailable"));
    await expect(withRetry(fn, 2, 10)).rejects.toThrow("503");
    expect(fn).toHaveBeenCalledTimes(3); // 初始1 + 重试2
  });
});
