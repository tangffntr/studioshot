/**
 * server/src/index.ts — Express 入口
 * 启动：pnpm dev（tsx watch）
 */
import "dotenv/config";
import express from "express";
import router from "./routes";

const app = express();
app.use(express.json({ limit: "50mb" })); // 图片 base64 较大
app.use(router);

const PORT = Number(process.env.PORT) || 4096;
app.listen(PORT, () => {
  console.log(`\n[@ecom/server] running on http://localhost:${PORT}`);
  console.log(`  POST /api/products   上传产品`);
  console.log(`  POST /api/jobs       提交出图任务`);
  console.log(`  GET  /api/events     SSE 进度流`);
  console.log(`  GET  /api/media      媒体列表\n`);
});
