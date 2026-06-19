# Phase 0 验证结论 — A2: SSE 可移植性

- 时间: 2026-06-19
- 验证脚本: packages/server/scripts/verify-sse.ts

## 结论: ✅ 通过

SSE（Server-Sent Events）在 Express 栈里完全跑通：

1. **服务端**（Express）：`/verify-sse/stream` 端点正确推送标准 SSE 格式
   ```
   event: test
   data: {"n":1,"time":"2026-06-19T03:03:15.199Z"}
   ```
   - Content-Type: text/event-stream ✓
   - 每秒一个事件，n 递增 ✓
   - 连接保持，客户端断开时清理 ✓
   - curl 实测连续收到 6+ 个事件 ✓

2. **前端**（SolidJS）：页面用标准 EventSource API 消费
   - EventSource 是 W3C 标准，opencode server-sdk.tsx 已验证同款模式
   - 服务端推送格式标准，浏览器解析无风险

## 对计划的影响

opencode 的 SSE 模式（§7.4）可直接移植到本项目的 Express 栈。
后续 Task 2.3（routes/events.ts）和 Task 2.4（web/context/sse.tsx）的
技术基础已验证可行。
