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

# ── 第六步：校验密钥配置 ──
# 密钥必须由部署环境注入（docker-compose 的 env_file → .env），绝不能写死在这个文件里。
# 写死等于公开：谁看到这个仓库，谁就能自己签发一个 admin token 登进系统，密码形同虚设。
if [ -z "$JWT_SECRET" ]; then
  echo ""
  echo "============================================"
  echo "  ❌ 致命错误：未设置 JWT_SECRET"
  echo "  在宿主机项目目录创建 .env 文件，写入："
  echo "    JWT_SECRET=<随机字符串>"
  echo "  生成方法： openssl rand -base64 48"
  echo "============================================"
  echo ""
  exit 1
fi

# 防呆：挡住示例值和历史上写死过的那个值
case "$JWT_SECRET" in
  xiangtai-production-jwt-2026|xiangtai-build-secret|change-me*|xiangtai-internal-secret-key-2026-dev-only)
    echo ""
    echo "============================================"
    echo "  ❌ JWT_SECRET 使用了公开的示例/默认值"
    echo "  这个值在代码仓库里出现过，等同于没有密钥。"
    echo "  请换成随机值： openssl rand -base64 48"
    echo "============================================"
    echo ""
    exit 1
    ;;
esac

# 长度过短的密钥容易被暴力破解
if [ "${#JWT_SECRET}" -lt 32 ]; then
  echo "[start.sh] ❌ JWT_SECRET 长度不足 32 位，请用 openssl rand -base64 48 重新生成"
  exit 1
fi
echo "[start.sh] ✅ JWT_SECRET 已配置 (${#JWT_SECRET} 字符)"

# CRON_SECRET 不是必须的，但没配的话定时任务分支会一直返回 401
if [ -z "$CRON_SECRET" ]; then
  echo "[start.sh] ⚠️  未设置 CRON_SECRET —— 定时任务接口将全部拒绝访问。"
  echo "[start.sh]    如果需要自动跑积分重算/月度生成，请在 .env 中补上。"
else
  echo "[start.sh] ✅ CRON_SECRET 已配置"
fi

# ── 第七步：启动应用 ──
echo "[start.sh] 🚀 启动应用 (port 3000)..."
exec npx next start -p 3000
