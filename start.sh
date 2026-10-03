#!/bin/sh
set -e
cd /app

echo "[start.sh] === 容器启动，初始化数据目录 ==="

# Validate the same configured source as getDb before any link/removal/seed.
# Do not delete /app/data.db: it may itself be a real mounted database.
# An explicit DB_PATH (including one in .env) is respected. Without an override,
# the mounted /app/data/data.db is selected (no destructive symlink replacement).
DB_PATH=$(node -e 'const {databasePath}=require("./src/lib/runtime-config.cjs");const {preflight}=require("./src/lib/database-policy.cjs");const selected=process.env.DB_PATH?databasePath:require("node:path").resolve("data/data.db");preflight(selected,"internal",process.env.ALLOW_EMPTY_DB==="1");process.stdout.write(selected)')
export DB_PATH
echo "[start.sh] 数据库源校验完成: $DB_PATH"

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
