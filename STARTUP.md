# OPC 电商出图 Agent 启动指南

## 快速启动

### Windows 用户
双击运行 `start.bat` 文件，或在命令行中执行：
```bash
start.bat
```

### Linux/Mac 用户
```bash
# 添加执行权限
chmod +x start.sh

# 运行启动脚本
./start.sh
```

## 启动菜单选项

启动脚本提供以下选项：

| 选项 | 功能 | 说明 |
|------|------|------|
| 1 | 启动全部服务 | 同时启动前端和后端服务器 |
| 2 | 仅启动后端服务器 | 只启动后端API服务器 |
| 3 | 仅启动前端开发服务器 | 只启动前端开发服务器 |
| 4 | 重启全部服务 | 停止所有服务并重新启动 |
| 5 | 构建项目 | 构建生产版本 |
| 6 | 清理构建缓存 | 清理dist和node_modules |

## 服务地址

启动成功后，可以通过以下地址访问：

- **前端界面**: http://localhost:5173 (或 http://localhost:5175)
- **后端API**: http://localhost:4096

## 手动启动

如果不想使用启动脚本，可以手动启动：

### 启动后端服务器
```bash
cd D:\zcode\opc
pnpm run dev:server
```

### 启动前端开发服务器
```bash
cd D:\zcode\opc
pnpm run dev:web
```

### 同时启动（使用 concurrently）
```bash
cd D:\zcode\opc
pnpm run dev:server &
pnpm run dev:web
```

## 停止服务

### Windows
- 在命令行窗口按 `Ctrl + C`
- 或者关闭命令行窗口

### Linux/Mac
- 按 `Ctrl + C`
- 或者使用 `kill` 命令停止进程

## 常见问题

### 端口被占用
如果遇到端口被占用的错误，可以：

1. 查找占用端口的进程：
```bash
# Windows
netstat -ano | findstr :4096

# Linux/Mac
lsof -i :4096
```

2. 停止占用端口的进程：
```bash
# Windows
taskkill /F /PID <进程ID>

# Linux/Mac
kill -9 <进程ID>
```

### 依赖未安装
如果遇到依赖未安装的错误，运行：
```bash
pnpm install
```

### 构建失败
如果构建失败，尝试清理缓存后重新构建：
```bash
# 清理构建缓存
rm -rf packages/web/dist
rm -rf packages/server/dist

# 重新构建
pnpm run build
```

## 开发模式

### 热重载
开发模式下，前后端都支持热重载：
- 前端：修改代码后自动刷新浏览器
- 后端：修改代码后自动重启服务器

### 调试
- 前端：使用浏览器开发者工具 (F12)
- 后端：在代码中添加 `console.log()` 或使用调试器

## 生产部署

### 构建生产版本
```bash
pnpm run build
```

### 启动生产版本
```bash
# 启动后端服务器
cd packages/server
node dist/index.js

# 前端静态文件在 packages/web/dist 目录
# 可以使用 Nginx 或其他 Web 服务器托管
```

## 配置说明

### 环境变量
后端服务器支持以下环境变量：
- `PORT`: 服务器端口（默认 4096）
- `NODE_ENV`: 运行环境（development/production）

### 数据库
项目使用 SQLite 数据库，数据文件位于：
```
packages/server/data/app.sqlite
```

### 文件存储
上传的文件存储在：
```
packages/server/data/oss/
```

## 获取帮助

如果遇到问题，可以：
1. 查看控制台错误信息
2. 检查日志文件
3. 提交 Issue 到项目仓库

---

**最后更新**: 2026-06-22
