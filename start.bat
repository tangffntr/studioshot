@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ===========================================
:: OPC 电商出图 Agent 启动脚本
:: ===========================================

:menu
cls
echo.
echo  ╔════════════════════════════════════════════════════════════╗
echo  ║           OPC 电商出图 Agent - 启动菜单                    ║
echo  ╠════════════════════════════════════════════════════════════╣
echo  ║                                                            ║
echo  ║   [1] 启动全部服务（前端 + 后端）                          ║
echo  ║   [2] 仅启动后端服务器                                     ║
echo  ║   [3] 仅启动前端开发服务器                                 ║
echo  ║   [4] 重启全部服务                                         ║
echo  ║   [5] 构建项目                                             ║
echo  ║   [6] 清理构建缓存                                         ║
echo  ║   [0] 退出                                                 ║
echo  ║                                                            ║
echo  ╚════════════════════════════════════════════════════════════╝
echo.
set /p choice=请选择操作 [0-6]:

if "%choice%"=="1" goto start_all
if "%choice%"=="2" goto start_server
if "%choice%"=="3" goto start_web
if "%choice%"=="4" goto restart_all
if "%choice%"=="5" goto build
if "%choice%"=="6" goto clean
if "%choice%"=="0" goto exit
echo 无效选择，请重试...
timeout /t 2 >nul
goto menu

:start_all
cls
echo.
echo  [启动] 正在启动全部服务...
echo.
echo  [INFO] 后端服务器将在 http://localhost:3000 启动
echo  [INFO] 前端开发服务器将在 http://localhost:5173 启动
echo  [INFO] 按 Ctrl+C 可停止服务
echo.
echo  ═══════════════════════════════════════════════════════════
echo.

:: 启动后端服务器（后台运行）
start "OPC-Server" cmd /c "cd /d D:\zcode\opc && pnpm run dev:server"

:: 等待2秒让后端先启动
timeout /t 2 >nul

:: 启动前端开发服务器（前台运行）
echo  [INFO] 正在启动前端服务器...
echo.
pnpm run dev:web

goto menu

:start_server
cls
echo.
echo  [启动] 正在启动后端服务器...
echo.
echo  [INFO] 服务器将在 http://localhost:3000 启动
echo  [INFO] 按 Ctrl+C 可停止服务
echo.
echo  ═══════════════════════════════════════════════════════════
echo.
pnpm run dev:server
goto menu

:start_web
cls
echo.
echo  [启动] 正在启动前端开发服务器...
echo.
echo  [INFO] 前端将在 http://localhost:5173 启动
echo  [INFO] 按 Ctrl+C 可停止服务
echo.
echo  ═══════════════════════════════════════════════════════════
echo.
pnpm run dev:web
goto menu

:restart_all
cls
echo.
echo  [重启] 正在重启全部服务...
echo.

:: 停止所有Node.js进程
echo  [INFO] 正在停止现有服务...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 >nul

echo  [INFO] 服务已停止，正在重新启动...
echo.
echo  ═══════════════════════════════════════════════════════════
echo.

:: 启动后端服务器（后台运行）
start "OPC-Server" cmd /c "cd /d D:\zcode\opc && pnpm run dev:server"

:: 等待2秒让后端先启动
timeout /t 2 >nul

:: 启动前端开发服务器（前台运行）
echo  [INFO] 正在启动前端服务器...
echo.
pnpm run dev:web

goto menu

:build
cls
echo.
echo  [构建] 正在构建项目...
echo.
echo  ═══════════════════════════════════════════════════════════
echo.
pnpm run build
echo.
echo  [完成] 构建完成！
echo.
pause
goto menu

:clean
cls
echo.
echo  [清理] 正在清理构建缓存...
echo.
echo  ═══════════════════════════════════════════════════════════
echo.

:: 清理前端构建缓存
if exist "packages\web\dist" (
    echo  [INFO] 清理前端构建缓存...
    rmdir /s /q "packages\web\dist"
)

:: 清理后端构建缓存
if exist "packages\server\dist" (
    echo  [INFO] 清理后端构建缓存...
    rmdir /s /q "packages\server\dist"
)

:: 清理node_modules（可选）
set /p clean_modules=是否清理 node_modules？[y/N]:
if /i "%clean_modules%"=="y" (
    echo  [INFO] 清理 node_modules...
    if exist "node_modules" rmdir /s /q "node_modules"
    if exist "packages\web\node_modules" rmdir /s /q "packages\web\node_modules"
    if exist "packages\server\node_modules" rmdir /s /q "packages\server\node_modules"
    if exist "packages\shared\node_modules" rmdir /s /q "packages\shared\node_modules"
    echo  [INFO] 请运行 pnpm install 重新安装依赖
)

echo.
echo  [完成] 清理完成！
echo.
pause
goto menu

:exit
echo.
echo  感谢使用 OPC 电商出图 Agent！
echo.
exit /b 0
