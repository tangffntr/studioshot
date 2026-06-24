#!/bin/bash

# ===========================================
# OPC 电商出图 Agent 启动脚本 (Linux/Mac)
# ===========================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示菜单
show_menu() {
    clear
    echo ""
    echo "  ╔════════════════════════════════════════════════════════════╗"
    echo "  ║           OPC 电商出图 Agent - 启动菜单                    ║"
    echo "  ╠════════════════════════════════════════════════════════════╣"
    echo "  ║                                                            ║"
    echo "  ║   [1] 启动全部服务（前端 + 后端）                          ║"
    echo "  ║   [2] 仅启动后端服务器                                     ║"
    echo "  ║   [3] 仅启动前端开发服务器                                 ║"
    echo "  ║   [4] 重启全部服务                                         ║"
    echo "  ║   [5] 构建项目                                             ║"
    echo "  ║   [6] 清理构建缓存                                         ║"
    echo "  ║   [0] 退出                                                 ║"
    echo "  ║                                                            ║"
    echo "  ╚════════════════════════════════════════════════════════════╝"
    echo ""
    read -p "  请选择操作 [0-6]: " choice
}

# 启动全部服务
start_all() {
    clear
    echo ""
    print_info "正在启动全部服务..."
    echo ""
    print_info "后端服务器将在 http://localhost:3000 启动"
    print_info "前端开发服务器将在 http://localhost:5173 启动"
    print_info "按 Ctrl+C 可停止服务"
    echo ""
    echo "  ═══════════════════════════════════════════════════════════"
    echo ""

    # 启动后端服务器（后台运行）
    cd /d/zcode/opc
    pnpm run dev:server &
    SERVER_PID=$!

    # 等待2秒让后端先启动
    sleep 2

    # 启动前端开发服务器（前台运行）
    print_info "正在启动前端服务器..."
    echo ""
    pnpm run dev:web

    # 停止后端服务器
    kill $SERVER_PID 2>/dev/null
}

# 仅启动后端服务器
start_server() {
    clear
    echo ""
    print_info "正在启动后端服务器..."
    echo ""
    print_info "服务器将在 http://localhost:3000 启动"
    print_info "按 Ctrl+C 可停止服务"
    echo ""
    echo "  ═══════════════════════════════════════════════════════════"
    echo ""
    cd /d/zcode/opc
    pnpm run dev:server
}

# 仅启动前端开发服务器
start_web() {
    clear
    echo ""
    print_info "正在启动前端开发服务器..."
    echo ""
    print_info "前端将在 http://localhost:5173 启动"
    print_info "按 Ctrl+C 可停止服务"
    echo ""
    echo "  ═══════════════════════════════════════════════════════════"
    echo ""
    cd /d/zcode/opc
    pnpm run dev:web
}

# 重启全部服务
restart_all() {
    clear
    echo ""
    print_info "正在重启全部服务..."
    echo ""

    # 停止所有Node.js进程
    print_info "正在停止现有服务..."
    pkill -f "node" 2>/dev/null
    sleep 2

    print_info "服务已停止，正在重新启动..."
    echo ""
    echo "  ═══════════════════════════════════════════════════════════"
    echo ""

    # 启动后端服务器（后台运行）
    cd /d/zcode/opc
    pnpm run dev:server &
    SERVER_PID=$!

    # 等待2秒让后端先启动
    sleep 2

    # 启动前端开发服务器（前台运行）
    print_info "正在启动前端服务器..."
    echo ""
    pnpm run dev:web

    # 停止后端服务器
    kill $SERVER_PID 2>/dev/null
}

# 构建项目
build() {
    clear
    echo ""
    print_info "正在构建项目..."
    echo ""
    echo "  ═══════════════════════════════════════════════════════════"
    echo ""
    cd /d/zcode/opc
    pnpm run build
    echo ""
    print_success "构建完成！"
    echo ""
    read -p "按 Enter 键继续..."
}

# 清理构建缓存
clean() {
    clear
    echo ""
    print_info "正在清理构建缓存..."
    echo ""
    echo "  ═══════════════════════════════════════════════════════════"
    echo ""

    # 清理前端构建缓存
    if [ -d "packages/web/dist" ]; then
        print_info "清理前端构建缓存..."
        rm -rf "packages/web/dist"
    fi

    # 清理后端构建缓存
    if [ -d "packages/server/dist" ]; then
        print_info "清理后端构建缓存..."
        rm -rf "packages/server/dist"
    fi

    # 清理node_modules（可选）
    read -p "是否清理 node_modules？[y/N]: " clean_modules
    if [[ $clean_modules =~ ^[Yy]$ ]]; then
        print_info "清理 node_modules..."
        rm -rf "node_modules"
        rm -rf "packages/web/node_modules"
        rm -rf "packages/server/node_modules"
        rm -rf "packages/shared/node_modules"
        print_warning "请运行 pnpm install 重新安装依赖"
    fi

    echo ""
    print_success "清理完成！"
    echo ""
    read -p "按 Enter 键继续..."
}

# 主循环
while true; do
    show_menu
    case $choice in
        1) start_all ;;
        2) start_server ;;
        3) start_web ;;
        4) restart_all ;;
        5) build ;;
        6) clean ;;
        0)
            echo ""
            echo "  感谢使用 OPC 电商出图 Agent！"
            echo ""
            exit 0
            ;;
        *)
            echo ""
            print_error "无效选择，请重试..."
            sleep 2
            ;;
    esac
done
