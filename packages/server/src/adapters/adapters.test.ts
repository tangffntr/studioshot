import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrsaiAdapter } from "./grsai";
import { getAdapter, listAdapters } from "./registry";
import { extractHost } from "./base";

// mock global fetch
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

describe("extractHost", () => {
  it("去除 /v1 后缀", () => {
    expect(extractHost("https://grsai.dakka.com.cn/v1/api/generate")).toBe("https://grsai.dakka.com.cn");
    expect(extractHost("https://grsai.dakka.com.cn")).toBe("https://grsai.dakka.com.cn");
    expect(extractHost("https://a.com/v1/")).toBe("https://a.com");
  });
});

describe("GrsaiAdapter", () => {
  it("generateImage 成功路径：解析 results[0].url 并下载", async () => {
    const imgBase64 = Buffer.from("fake-png-bytes").toString("base64");
    // 第一次 fetch：/v1/api/generate 返回 url
    // 第二次 fetch：下载图片
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "t1", status: "succeeded", results: [{ url: "https://cdn/x.png" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from("fake-png-bytes"),
      });

    const adapter = new GrsaiAdapter();
    const result = await adapter.generateImage(
      { model: "gpt-image-2", prompt: "a mug", referenceImages: ["abc"], size: "1024x1024" },
      { apiKey: "sk-test", baseUrl: "https://grsai.dakka.com.cn/v1" }
    );

    expect(result.base64).toBe(imgBase64);
    expect(result.mime).toBe("image/png");
    expect(result.cost).toBe(50);
    expect(result.meta?.taskId).toBe("t1");

    // 验证第一次请求体
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(callBody.model).toBe("gpt-image-2");
    expect(callBody.images[0]).toContain("data:image/png;base64,");
    expect(callBody.replyType).toBe("json");
  });

  it("缺 apiKey 抛错", async () => {
    const adapter = new GrsaiAdapter();
    await expect(adapter.generateImage({ model: "gpt-image-2", prompt: "x" }, {})).rejects.toThrow("apiKey");
  });

  it("API 返回非 ok 抛错", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "unauthorized" });
    const adapter = new GrsaiAdapter();
    await expect(
      adapter.generateImage({ model: "gpt-image-2", prompt: "x" }, { apiKey: "sk-test" })
    ).rejects.toThrow("401");
  });

  it("无 results url 抛错", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "t1", status: "failed" }) });
    const adapter = new GrsaiAdapter();
    await expect(
      adapter.generateImage({ model: "gpt-image-2", prompt: "x" }, { apiKey: "sk-test" })
    ).rejects.toThrow("未返回图片");
  });
});

describe("registry", () => {
  it("注册了 grsai、openai-chat、aliyun-tryon", () => {
    expect(listAdapters().sort()).toEqual(["aliyun-tryon", "grsai", "openai-chat"]);
  });

  it("getAdapter 返回正确实例", () => {
    expect(getAdapter("grsai").category).toBe("image");
    expect(getAdapter("openai-chat").category).toBe("vlm");
  });

  it("未知供应商抛错", () => {
    expect(() => getAdapter("unknown")).toThrow("未注册");
  });
});
