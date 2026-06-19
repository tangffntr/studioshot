/**
 * server/agent/event-bus.ts — SSE 事件总线
 * Agent 循环 publish 事件，routes/events 的 SSE 端点 subscribe 推送。
 * 内存实现（单机够用）；按 jobId 过滤，前端只收自己关注的事件。
 */
import type { SseEvent } from "@ecom/shared";

type Subscriber = (event: SseEvent) => void;

class EventBus {
  private subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(event: SseEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // 订阅者异常不影响其他订阅者
      }
    }
  }
}

export const eventBus = new EventBus();
