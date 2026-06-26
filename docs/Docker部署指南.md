# Docker 部署指南

本文档说明如何将 OPC 电商出图平台部署到云服务器（单容器架构）。

## 架构

```
单容器（node:20-slim）
├── 后端 Express（端口 4096）
│   ├── /api/*        API 接口
│   ├── /oss/*        静态文件（生成的图片）
│   └── /*            前端 SPA（web/dist）
├── 前端静态文件（由后端托管）
└── data/（Volume 持久化）
    ├── app.sqlite    数据库
    └── oss/          生成的图片文件
```

## 前置条件

- 云服务器已安装 Docker
- 域名已解析到服务器（如需 HTTPS，配反向代理或证书）

## 部署步骤

### 1. 上传代码到服务器

```bash
# 方式一：git clone（推荐）
git clone <你的仓库地址> /opt/opc
cd /opt/opc

# 方式二：本地打包上传
scp -r . root@你的服务器IP:/opt/opc
```

### 2. 创建 .env 配置

在项目根目录（与 Dockerfile 同级）创建 `.env`：

```bash
cp .env.example .env
vim .env
```

**必须配置的变量**：
```ini
# 主推理 LLM（核心，必须）
ORCHESTRATOR_BASE_URL=https://your-llm-endpoint/v1
ORCHESTRATOR_API_KEY=your-key
ORCHESTRATOR_MODEL=your-model

# 凭证加密主密钥（生产必须，生成方式见下）
MASTER_KEY=<openssl rand -hex 32 生成的64位hex>
NODE_ENV=production

# 生图模型（按需）
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://your-image-endpoint
AGNES_API_KEY=your-key

# 腾讯云 COS（图生视频/试穿需要，按需）
COS_SECRET_ID=your-id
COS_SECRET_KEY=your-key
COS_APP_ID=your-appid
COS_BUCKET=your-bucket-appid
COS_REGION=ap-shanghai
COS_PUBLIC_BASE=https://cos.yourdomain.com
```

生成 MASTER_KEY：
```bash
openssl rand -hex 32
```

### 3. 构建镜像

```bash
docker build -t opc:latest .
```

首次构建约 5-10 分钟（编译 better-sqlite3/sharp 原生模块）。后续构建利用缓存会快很多。

### 4. 启动容器

```bash
# 创建数据持久化目录
mkdir -p /opt/opc-data

# 启动（.env 挂载 + data volume + 端口映射）
docker run -d \
  --name opc \
  --restart unless-stopped \
  --env-file .env \
  -v /opt/opc-data:/app/packages/server/data \
  -p 4096:4096 \
  opc:latest
```

**参数说明**：
- `--env-file .env`：挂载环境变量（API keys 等不打包进镜像）
- `-v /opt/opc-data:/app/packages/server/data`：数据持久化（数据库+图片）
- `-p 4096:4096`：端口映射（如需 80 改 `-p 80:4096`）
- `--restart unless-stopped`：自动重启

### 5. 验证

```bash
# 查看日志
docker logs -f opc

# 健康检查
curl http://localhost:4096/api/materials

# 浏览器访问
http://你的服务器IP:4096
```

## 更新部署

代码更新后，重新构建并替换容器：

```bash
git pull                          # 拉取新代码
docker build -t opc:latest .      # 重新构建
docker stop opc && docker rm opc  # 停止旧容器
docker run -d ... opc:latest      # 用相同命令启动（数据在 volume 不丢失）
```

## 数据备份

```bash
# 备份数据库和图片
cp -r /opt/opc-data /backup/opc-data-$(date +%Y%m%d)

# 或打包
tar -czf /backup/opc-data-$(date +%Y%m%d).tar.gz /opt/opc-data
```

## 常见问题

### Q: better-sqlite3 编译失败？
确保 builder 阶段有 python3/make/g++（Dockerfile 已装）。如仍失败，检查 Node 版本兼容性（要求 Node 20+）。

### Q: sharp 报 libvips 错？
runtime 阶段已装 `libvips-dev`。如仍报错，尝试 `apt-get install -y libvips`。

### Q: 视频生成失败（agnes 图生视频）？
需配置 COS_*（公网图片 URL）。未配置时 agnes 视频端点无法拉取首帧图。

### Q: 如何用 HTTPS？
在容器前加 Nginx/Caddy 反向代理：
```bash
# Caddy 示例（自动 HTTPS）
docker run -d --name caddy -p 80:80 -p 443:443 \
  -v caddy_data:/data \
  caddy caddy reverse-proxy --from yourdomain.com --to localhost:4096
```

### Q: 首次启动数据库是空的？
首次启动会自动 seed（创建默认供应商/模型/模板/素材）。然后在设置页配置各模型的 API Key 和凭证。

## 文件清单

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 多阶段构建（builder 编译 + runtime 运行） |
| `.dockerignore` | 排除 node_modules/data/dist 等 |
| `.env.example` | 环境变量模板（含 COS） |
| `.env` | 实际配置（不入 git，部署时创建） |
