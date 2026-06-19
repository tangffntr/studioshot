import { describe, it, expect } from "vitest";
import { z } from "zod";
import { make, toolsToOpenAIFormat, type Content } from "./tool";

describe("tool factory", () => {
  it("make 生成工具，含 jsonSchema", () => {
    const schema = z.object({ prompt: z.string(), n: z.number() });
    const t = make("test_tool", {
      description: "a test",
      input: schema,
      async execute() {
        return { ok: true };
      },
    });
    expect(t.name).toBe("test_tool");
    expect(t.description).toBe("a test");
    expect(t.jsonSchema.type).toBe("object");
    expect((t.jsonSchema.properties as any).prompt).toBeDefined();
  });

  it("默认 toModelOutput 返回空数组", async () => {
    const t = make("t", {
      description: "x",
      input: z.object({}),
      async execute() {
        return 42;
      },
    });
    const out = t.toModelOutput({}, 42);
    expect(out).toEqual([]);
  });

  it("自定义 toModelOutput 返回 file（图片回灌）", async () => {
    const t = make("img", {
      description: "x",
      input: z.object({}),
      async execute() {
        return { base64: "AAA", mime: "image/png" };
      },
      toModelOutput(_i, o): Content[] {
        return [{ type: "file", data: (o as any).base64, mime: (o as any).mime, name: "x.png" }];
      },
    });
    const out = t.toModelOutput({}, { base64: "AAA", mime: "image/png" });
    expect(out[0].type).toBe("file");
    expect((out[0] as any).data).toBe("AAA");
    expect((out[0] as any).mime).toBe("image/png");
  });

  it("toolsToOpenAIFormat 转成 function 格式", () => {
    const t1 = make("a", { description: "A", input: z.object({ x: z.string() }), async execute() { return 1; } });
    const t2 = make("b", { description: "B", input: z.object({ y: z.number() }), async execute() { return 2; } });
    const fmt = toolsToOpenAIFormat([t1, t2]);
    expect(fmt).toHaveLength(2);
    expect(fmt[0].type).toBe("function");
    expect(fmt[0].function.name).toBe("a");
    expect(fmt[1].function.name).toBe("b");
    expect((fmt[0].function.parameters.properties as any).x).toBeDefined();
  });
});
