#!/bin/bash
# ============================================================
# OPC 部署脚本（在服务器项目目录运行）
# 作用：拉取最新代码 → 构建 Docker 镜像 → 重启容器
# 用法：bash deploy.sh
# ============================================================
set -e

PROJECT_DIR="/opt/opc"
DATA_DIR="/opt/opc-data"
CONTAINER_NAME="opc"
IMAGE_NAME="opc:latest"

echo "=========================================="
echo "  OPC 部署"
echo "=========================================="

cd "$PROJECT_DIR" 2>/dev/null || {
    echo "❌ 项目目录 $PROJECT_DIR 不存在"
    echo "   先执行: git clone /opt/opc.git /opt/opc"
    exit 1
}

# ---- 1. 拉取最新代码 ----
echo ""
echo "[1/4] 拉取最新代码..."
git fetch origin
git reset --hard origin/master   # 强制对齐远程（丢弃本地未提交改动）
echo "  当前版本: $(git log --oneline -1)"

# ---- 2. 检查 .env ----
echo ""
echo "[2/4] 检查 .env 配置..."
if [ ! -f ".env" ]; then
    echo "  ⚠️  .env 不存在，从模板创建..."
    cp .env.example .env
    echo "  ❗ 请先编辑 .env 填入 API keys，然后重新运行本脚本"
    echo "     vim .env"
    exit 1
fi
# 检查关键变量是否已填（非空）
if grep -q "^MASTER_KEY=$" .env 2>/dev/null; then
    echo "  ⚠️  MASTER_KEY 未配置，正在生成..."
    echo "MASTER_KEY=$(openssl rand -hex 32)" >> .env
    echo "  ✅ 已自动生成 MASTER_KEY"
fi
echo "  ✅ .env 已配置"

# ---- 3. 构建 Docker 镜像 ----
echo ""
echo "[3/4] 构建 Docker 镜像（首次约5-10分钟）..."
docker build -t "$IMAGE_NAME" .
echo "  ✅ 镜像构建完成"

# ---- 4. 重启容器 ----
echo ""
echo "[4/4] 重启容器..."
# 停止并删除旧容器（如果存在）
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
    echo "  已停止旧容器"
fi

# 启动新容器
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --env-file .env \
    -v "$DATA_DIR:/app/packages/server/data" \
    -p 4096:4096 \
    "$IMAGE_NAME"

echo "  ✅ 容器已启动"

# ---- 验证 ----
echo ""
echo "=========================================="
echo "  ✅ 部署完成！"
echo "=========================================="
echo ""
echo "容器状态:"
docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "访问: http://$(hostname -I | awk '{print $1}'):4096"
echo ""
echo "查看日志: docker logs -f $CONTAINER_NAME"
echo "停止:     docker stop $CONTAINER_NAME"
echo "重新部署: bash deploy.sh"
