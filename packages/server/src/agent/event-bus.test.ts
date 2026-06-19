import { describe, it, expect, vi } from "vitest";
import { eventBus } from "./event-bus";
import type { SseEvent } from "@ecom/shared";

describe("eventBus", () => {
  it("订阅者收到发布的事件", () => {
    const fn = vi.fn();
    const unsub = eventBus.subscribe(fn);
    const evt: SseEvent = { type: "job.started", jobId: "j1" };
    eventBus.publish(evt);
    expect(fn).toHaveBeenCalledWith(evt);
    unsub();
  });

  it("取消订阅后不再收到", () => {
    const fn = vi.fn();
    const unsub = eventBus.subscribe(fn);
    unsub();
    eventBus.publish({ type: "job.progress", jobId: "j1", progress: 50, message: "x" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("一个订阅者异常不影响其他", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    eventBus.subscribe(bad);
    eventBus.subscribe(good);
    eventBus.publish({ type: "job.completed", jobId: "j1", resultMediaIds: [] });
    expect(good).toHaveBeenCalled();
  });

  it("多个订阅者都收到", () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = eventBus.subscribe(a);
    const ub = eventBus.subscribe(b);
    eventBus.publish({ type: "tool.call", jobId: "j1", toolName: "generate_image", toolInput: {} });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    ua();
    ub();
  });
});
