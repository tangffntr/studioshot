# Docker 部署指南

本文档说明如何将 OPC 电商出图平台部署到云服务器（单容器架构 + 自建 git 仓库）。

## 完整流程

```
本地开发机                      云服务器(Ubuntu)
─────────────                  ──────────────────
                               ① bash server-setup.sh    (一次性初始化)
② git remote add origin ...
③ git push -u origin master  → bare git 仓库 /opt/opc.git
                               ④ git clone /opt/opc.git /opt/opc
                               ⑤ 配置 .env
                               ⑥ bash deploy.sh           (一键部署)
                                  └→ 访问 http://IP:4096
```

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

---

## 步骤详解

### 步骤 1：服务器初始化（一次性，在服务器上执行）

SSH 登录云服务器，上传并运行初始化脚本：

```bash
# 方式一：本地先把 server-setup.sh 上传到服务器
scp server-setup.sh root@你的服务器IP:/root/
ssh root@你的服务器IP
bash /root/server-setup.sh

# 方式二：直接在服务器上手动执行脚本内容
```

脚本会自动：检查/安装 Docker + Git、创建 bare git 仓库 `/opt/opc.git`、创建数据目录 `/opt/opc-data`。

完成后脚本会显示服务器 IP，记下来。

### 步骤 2：本地添加远程并推送（在开发机执行）

```bash
cd /path/to/opc   # 你的本地项目目录

# 添加远程（替换 YOUR_SERVER_IP）
git remote add origin ssh://root@YOUR_SERVER_IP/opt/opc.git

# 推送
git push -u origin master
```

### 步骤 3：服务器拉取代码 + 配置环境变量

```bash
ssh root@YOUR_SERVER_IP

# 克隆代码
git clone /opt/opc.git /opt/opc
cd /opt/opc

# 配置环境变量
cp .env.example .env
vim .env
```

**必须配置的变量**：
```ini
# 主推理 LLM（核心，必须）
ORCHESTRATOR_BASE_URL=https://your-llm-endpoint/v1
ORCHESTRATOR_API_KEY=your-key
ORCHESTRATOR_MODEL=your-model

# 凭证加密主密钥（deploy.sh 会自动生成，也可手动）
# 生成: openssl rand -hex 32
MASTER_KEY=
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

### 步骤 4：一键部署

```bash
bash deploy.sh
```

脚本自动：拉取最新代码 → 构建 Docker 镜像 → 启动容器。完成后显示访问地址。

### 步骤 5：访问验证

```bash
# 查看日志（确认启动成功）
docker logs -f opc

# 健康检查
curl http://localhost:4096/api/materials

# 浏览器访问
http://你的服务器IP:4096
```

---

## 后续更新部署

本地改完代码并 commit 后，**一条命令完成更新**：

```bash
# 本地推送
git push origin master

# 服务器拉取+重新部署（SSH 到服务器）
cd /opt/opc && bash deploy.sh
```

`deploy.sh` 会自动 git pull + 重建镜像 + 重启容器，**数据不丢失**（在 /opt/opc-data volume 里）。

---

## 数据备份

```bash
# 备份数据库和图片（在服务器上）
tar -czf /backup/opc-data-$(date +%Y%m%d).tar.gz /opt/opc-data

# 定时备份（crontab）
echo "0 3 * * * tar -czf /backup/opc-data-$(date +\%Y\%m\%d).tar.gz /opt/opc-data" | crontab
```

---

## 常见问题

### Q: better-sqlite3 编译失败？
确保 Dockerfile builder 阶段有 python3/make/g++（已配置）。如仍失败，检查 Node 版本（要求 20+）。

### Q: sharp 报 libvips 错？
runtime 阶段已装 `libvips-dev`。如仍报错：`apt-get install -y libvips`。

### Q: 视频生成失败（agnes 图生视频）？
需配置 COS_*（公网图片 URL）。未配置时 agnes 无法拉取首帧图。

### Q: push 时权限拒绝？
确保 SSH 密钥已配置（本地 `ssh-keygen` + `ssh-copy-id root@服务器IP`），或服务器允许密码登录。

### Q: 如何用 HTTPS？
在容器前加 Caddy 反向代理（自动 HTTPS）：
```bash
docker run -d --name caddy --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v caddy_data:/data \
  caddy caddy reverse-proxy --from yourdomain.com --to localhost:4096
```

### Q: 首次启动数据库是空的？
首次启动自动 seed（创建默认供应商/模型/模板）。然后在设置页配置各模型 API Key 和凭证。

---

## 文件清单

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 多阶段构建（builder 编译 + runtime 运行） |
| `.dockerignore` | 排除 node_modules/data/dist 等 |
| `server-setup.sh` | 服务器初始化脚本（一次性） |
| `deploy.sh` | 服务器部署脚本（每次更新跑） |
| `.env.example` | 环境变量模板 |
| `.env` | 实际配置（不入 git，部署时创建） |
