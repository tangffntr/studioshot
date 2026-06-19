import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5174,
    proxy: {
      // 前端开发时代理到后端
      "/api": "http://localhost:4096",
      "/oss": "http://localhost:4096",
    },
  },
});
