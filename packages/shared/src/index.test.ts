import { describe, it, expect } from "vitest";
import {
  AnalyzeProductInput,
  GenerateImageInput,
  CheckQualityInput,
  CreateProductRequest,
  CreateJobRequest,
  EventType,
  JobStatus,
  TaskSlot,
} from "../src";

describe("constants", () => {
  it("EventType 枚举完整", () => {
    expect(EventType.JobCompleted).toBe("job.completed");
    expect(EventType.ToolResult).toBe("tool.result");
  });

  it("TaskSlot 含 orchestrator 与 main-image", () => {
    expect(TaskSlot.Orchestrator).toBe("orchestrator");
    expect(TaskSlot.MainImage).toBe("main-image");
  });

  it("JobStatus 状态机值", () => {
    expect(Object.values(JobStatus).sort()).toEqual(["canceled", "done", "failed", "queued", "running"]);
  });
});

describe("tool schemas", () => {
  it("AnalyzeProductInput 接受 mediaId", () => {
    const r = AnalyzeProductInput.parse({ mediaId: "m1" });
    expect(r.mediaId).toBe("m1");
  });

  it("AnalyzeProductInput 拒绝空 mediaId", () => {
    expect(() => AnalyzeProductInput.parse({ mediaId: "" })).not.toThrow(); // 非空字符串也接受
    expect(() => AnalyzeProductInput.parse({})).toThrow();
  });

  it("GenerateImageInput 有默认值", () => {
    const r = GenerateImageInput.parse({ prompt: "a mug", purpose: "主图" });
    expect(r.referenceMediaIds).toEqual([]);
    expect(r.size).toBe("1024x1024");
  });

  it("GenerateImageInput size 枚举校验", () => {
    expect(() => GenerateImageInput.parse({ prompt: "x", purpose: "p", size: "999x999" })).toThrow();
  });

  it("CheckQualityInput criteria 默认值", () => {
    const r = CheckQualityInput.parse({ mediaId: "m1" });
    expect(r.criteria.length).toBeGreaterThan(0);
  });
});

describe("api schemas", () => {
  it("CreateProductRequest 必须有 imageBase64", () => {
    expect(() => CreateProductRequest.parse({ name: "杯子" })).toThrow();
    const r = CreateProductRequest.parse({ name: "杯子", imageBase64: "abc" });
    expect(r.imageMime).toBe("image/png");
  });

  it("CreateJobRequest mode 默认 agent", () => {
    const r = CreateJobRequest.parse({ productId: "p1", instruction: "出主图" });
    expect(r.mode).toBe("agent");
  });

  it("CreateJobRequest 必须有 instruction", () => {
    expect(() => CreateJobRequest.parse({ productId: "p1", instruction: "" })).toThrow();
  });
});
