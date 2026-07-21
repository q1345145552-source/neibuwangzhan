#!/bin/sh
set -e
cd /app

echo "[start.sh] === 容器启动，初始化数据目录 ==="

# ── 第一步：确保数据挂载目录存在 ──
if [ ! -d /app/data ]; then
  echo ""
  echo "============================================"
  echo "  ❌ 致命错误：数据库挂载目录 /app/data 不存在"
  echo "  请检查 docker-compose.yml 的 volumes 配置"
  echo "  确认宿主机目录 /data/neibuxitong 存在且可访问"
  echo "============================================"
  echo ""
  exit 1
fi

# ── 第二步：删除镜像构建时可能残留的数据库文件 ──
# 这些文件不应存在（.dockerignore 已排除），但以防万一
if [ -f /app/data.db ]; then
  echo "[start.sh] ⚠️ 检测到镜像内残留的 data.db，正在删除..."
  rm -f /app/data.db
fi
if [ -f /app/data.db-wal ] || [ -f /app/data.db-shm ]; then
  echo "[start.sh] ⚠️ 清除残留的 WAL 文件..."
  rm -f /app/data.db-wal /app/data.db-shm
fi

# ── 第三步：验证挂载的真实数据库存在 ──
if [ ! -f /app/data/data.db ]; then
  echo ""
  echo "============================================"
  echo "  ❌ 致命错误：真实数据库 /app/data/data.db 不存在"
  echo "  宿主机挂载目录中未找到 data.db 文件"
  echo "  请确认 /data/neibuxitong/data.db 存在"
  echo "  如果数据库丢失，请从备份恢复后重试"
  echo "============================================"
  echo ""
  exit 1
fi

DB_SIZE=$(du -h /app/data/data.db | cut -f1)
echo "[start.sh] ✅ 真实数据库已就绪 ($DB_SIZE)"

# ── 第四步：创建符号链接指向挂载的真实数据库 ──
ln -sf /app/data/data.db /app/data.db
echo "[start.sh] ✅ /app/data.db → /app/data/data.db"

# ── 第五步：创建 uploads / files 目录并链接 ──
mkdir -p /app/data/uploads /app/data/files
ln -sf /app/data/uploads /app/uploads
ln -sf /app/data/files /app/files
echo "[start.sh] ✅ uploads / files 符号链接已就绪"

# ── 第六步：启动应用 ──
export JWT_SECRET=xiangtai-production-jwt-2026
echo "[start.sh] 🚀 启动应用 (port 3000)..."
exec npx next start -p 3000
