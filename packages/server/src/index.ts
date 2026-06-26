/**
 * server/src/index.ts — Express 入口
 * 启动：pnpm dev（tsx watch）
 */
import "dotenv/config";
import express from "express";
import * as path from "node:path";
import * as fs from "node:fs";
import router from "./routes";

const app = express();
app.use(express.json({ limit: "50mb" })); // 图片 base64 较大
app.use(router);

// 生产环境：托管前端静态文件（packages/web/dist）+ SPA fallback
// 开发环境（dist 不存在）跳过，前端走 vite dev server
const webDist = path.resolve(process.cwd(), "../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback：非 /api、/oss 的 GET 请求都返回 index.html（支持前端路由）
  app.get(/^(?!\/api|\/oss).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
  console.log(`[@ecom/server] 托管前端静态文件: ${webDist}`);
}

const PORT = Number(process.env.PORT) || 4096;
app.listen(PORT, () => {
  console.log(`\n[@ecom/server] running on http://localhost:${PORT}`);
  console.log(`  POST /api/products   上传产品`);
  console.log(`  POST /api/jobs       提交出图任务`);
  console.log(`  GET  /api/events     SSE 进度流`);
  console.log(`  GET  /api/media      媒体列表\n`);
});
