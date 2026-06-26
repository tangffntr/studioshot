#!/bin/bash
# ============================================================
# OPC 服务器初始化脚本（Ubuntu/Debian）— 在云服务器上运行一次
# 作用：检查 Docker、创建 bare git 仓库、创建数据目录
# 用法：bash server-setup.sh
# ============================================================
set -e

echo "=========================================="
echo "  OPC 服务器初始化"
echo "=========================================="

# ---- 1. 检查 Docker ----
echo ""
echo "[1/4] 检查 Docker..."
if command -v docker &> /dev/null; then
    echo "  ✅ Docker 已安装: $(docker --version)"
else
    echo "  ❌ Docker 未安装，正在安装..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  ✅ Docker 安装完成: $(docker --version)"
fi

# ---- 2. 检查 Git ----
echo ""
echo "[2/4] 检查 Git..."
if command -v git &> /dev/null; then
    echo "  ✅ Git 已安装: $(git --version)"
else
    echo "  ⚠️ Git 未安装，正在安装..."
    apt-get update && apt-get install -y git
    echo "  ✅ Git 安装完成"
fi

# ---- 3. 创建 bare git 仓库（用于接收本地 push）----
echo ""
echo "[3/4] 创建 bare git 仓库..."
GIT_DIR="/opt/opc.git"
if [ -d "$GIT_DIR" ]; then
    echo "  ℹ️  $GIT_DIR 已存在，跳过"
else
    mkdir -p "$GIT_DIR"
    git init --bare "$GIT_DIR"
    echo "  ✅ bare git 仓库已创建: $GIT_DIR"
fi

# ---- 4. 创建数据持久化目录 ----
echo ""
echo "[4/4] 创建数据目录..."
DATA_DIR="/opt/opc-data"
mkdir -p "$DATA_DIR"
echo "  ✅ 数据目录已创建: $DATA_DIR"

# ---- 汇总 ----
echo ""
echo "=========================================="
echo "  ✅ 初始化完成！"
echo "=========================================="
echo ""
echo "下一步：在本地（开发机）执行："
echo ""
echo "  # 添加远程仓库（替换 YOUR_SERVER_IP）"
echo "  git remote add origin ssh://root@YOUR_SERVER_IP/opt/opc.git"
echo ""
echo "  # 推送代码"
echo "  git push -u origin master"
echo ""
echo "推送后，在服务器执行部署："
echo ""
echo "  git clone /opt/opc.git /opt/opc && cd /opt/opc"
echo "  cp .env.example .env && vim .env   # 填配置"
echo "  bash deploy.sh                       # 构建+启动容器"
echo ""
echo "服务器 IP: $(hostname -I | awk '{print $1}')"
