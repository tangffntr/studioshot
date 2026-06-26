# ============================================================
# OPC 电商出图平台 — 多阶段 Dockerfile（单容器）
# builder: 编译 shared/server/web + 安装原生依赖
# runtime: 精简运行时镜像
# ============================================================

# ---------- Builder 阶段 ----------
FROM node:20-slim AS builder

# 原生模块构建工具链（better-sqlite3 需要 python/make/g++）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 启用 corepack 管理 pnpm
RUN corepack enable

WORKDIR /app

# 先拷 workspace 配置和 lockfile（利用 Docker 层缓存）
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# 安装所有依赖（含 dev，用于构建）
RUN pnpm install --frozen-lockfile

# 拷贝源码
COPY packages/ packages/

# 按依赖顺序构建：shared 必须先（server/web 都依赖它的 dist）
RUN pnpm --filter @ecom/shared build \
 && pnpm --filter @ecom/server build \
 && pnpm --filter @ecom/web build

# 剪除 dev 依赖（runtime 只需生产依赖）
RUN pnpm --filter @ecom/server --prod deploy /app/server-prod

# ---------- Runtime 阶段 ----------
FROM node:20-slim AS runtime

# sharp 运行时依赖（libvips 等；sharp 0.33+ 通常 prebuilt，但保险起见装上）
# better-sqlite3 的 .node 已在 builder 编译，runtime 只需 libstdc++
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/packages/server

# 拷贝 server 生产依赖（已剪除 dev）
COPY --from=builder /app/server-prod/node_modules ./node_modules
# 拷贝 server 编译产物
COPY --from=builder /app/packages/server/dist ./dist
# 拷贝前端构建产物（后端静态托管）
COPY --from=builder /app/packages/web/dist ../web/dist
# 拷贝 shared 产物（server 运行时 import @ecom/shared 解析用）
COPY --from=builder /app/packages/shared/dist ../../shared/dist
COPY --from=builder /app/packages/shared/package.json ../../shared/package.json

# 数据目录（运行时由 volume 持久化）
RUN mkdir -p data
VOLUME ["/app/packages/server/data"]

# 环境变量默认值
ENV NODE_ENV=production
ENV PORT=4096

EXPOSE 4096

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4096)+'/api/materials').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
