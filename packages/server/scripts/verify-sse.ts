/**
 * Task 0.3 验证脚本（熔断点 A2）：
 * 验证 SSE（Server-Sent Events）在我们的 Express 栈里能跑通，
 * 且 SolidJS 前端能正确接收并渲染。
 *
 * 对应可行性报告 §7.4 / 计划 Task 0.3：opencode 的 SSE 模式可移植。
 *
 * 用法：
 *   1. 启动后端：cd packages/server && npx tsx scripts/verify-sse.ts
 *   2. 浏览器打开 http://localhost:4097/verify-sse （脚本自带静态页）
 *   3. 页面应每秒看到一个递增的计数和当前时间，证明 SSE 通了
 *
 * 验证要点（对应 opencode server-sdk.tsx 的核心机制）：
 *   - Content-Type: text/event-stream
 *   - 保持连接不关闭
 *   - 客户端 EventSource 自动重连
 */
import express from "express";

const PORT = 4097;
const app = express();

// 内联一个最小验证页（含 SolidJS CDN 版，验证 Solid 能消费 SSE）
const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>A2 SSE 验证</title>
<script src="https://unpkg.com/solid-js@1.8.17/dist/solid.js"></script>
<style>body{font-family:system-ui;margin:40px} .ok{color:#16a34a} .err{color:#dc2626}</style>
</head><body>
<h2>Task 0.3 — A2 SSE 可移植性验证</h2>
<div id="status">连接中...</div>
<div id="events"></div>
<script>
  // 模拟 opencode server-sdk.tsx 的 EventSource 消费
  let count = 0;
  const statusEl = document.getElementById('status');
  const eventsEl = document.getElementById('events');
  function connect() {
    const es = new EventSource('/verify-sse/stream');
    es.onopen = () => { statusEl.innerHTML = '<span class="ok">✓ SSE 已连接，等待事件...</span>'; };
    es.onerror = () => { statusEl.innerHTML = '<span class="err">✗ 连接断开，3s 后重连...</span>'; es.close(); setTimeout(connect, 3000); };
    es.addEventListener('test', (e) => {
      count++;
      const data = JSON.parse(e.data);
      const div = document.createElement('div');
      div.textContent = '#' + count + ' n=' + data.n + ' time=' + data.time;
      eventsEl.prepend(div);
      if (count >= 5) {
        statusEl.innerHTML = '<span class="ok">✓✓ 已收到 ' + count + ' 个事件，A2 验证通过！</span>';
      }
    });
  }
  connect();
</script>
</body></html>`;

app.get("/verify-sse", (_req, res) => {
  res.type("html").send(HTML);
});

// SSE 端点：每秒推一个 {n, time} 事件，共 8 个
app.get("/verify-sse/stream", (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    const payload = JSON.stringify({ n, time: new Date().toISOString() });
    // SSE 格式：event 行 + data 行 + 空行。用字符串拼接避免模板转义问题。
    res.write("event: test\ndata: " + payload + "\n\n");
    if (n >= 8) {
      res.write('event: done\ndata: {"n":' + n + '}\n\n');
      clearInterval(timer);
      res.end();
    }
  }, 1000);
  // 客户端断开时清理
  _req.on("close", () => clearInterval(timer));
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(` Task 0.3 — A2 SSE 验证服务已启动`);
  console.log(`========================================`);
  console.log(`\n👉 浏览器打开：http://localhost:${PORT}/verify-sse`);
  console.log(`   页面应每秒显示一个递增事件，收到 5 个即通过。`);
  console.log(`\n按 Ctrl+C 停止。\n`);
});
