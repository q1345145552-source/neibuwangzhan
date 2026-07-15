#!/bin/sh
set -e
cd "$(dirname "$0")"

# 杀掉旧进程
lsof -ti :3000 2>/dev/null | xargs kill 2>/dev/null
sleep 1

# 清理旧的 next 进程
pkill -f "next start" 2>/dev/null || true
sleep 1

export JWT_SECRET=xiangtai-production-jwt-2026

echo "=============================="
echo "  湘泰内部管理系统"
echo "=============================="

# 检查是否有构建
if [ ! -d ".next" ]; then
  echo "📦 首次构建中..."
  npx next build
  echo ""
fi

echo "🚀 启动服务 (端口 3000)..."
echo ""
echo "  登录地址: http://localhost:3000/login"
echo "  管理员: zhangsan@xiangtai.com / 123456"
echo ""
echo "  ⚠️  保持此窗口打开，不要关闭"
echo "=============================="
echo ""

exec npx next start -p 3000
