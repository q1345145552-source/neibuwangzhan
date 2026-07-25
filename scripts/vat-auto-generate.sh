#!/bin/sh
# VAT monthly auto-generate — run at 00:05 on the 1st of each month
# Calls the internal API to generate records for all enabled customers
#
# 需要环境变量 CRON_SECRET，且必须与应用容器里的 CRON_SECRET 一致。
# cron 示例（密钥放 /etc/xiangtai-cron.env，权限 600）：
#   5 0 1 * * . /etc/xiangtai-cron.env && /path/to/project/scripts/vat-auto-generate.sh
set -e

CONTAINER="neibuxitong"
MONTH=$(date +%Y-%m)  # current month, e.g. 2026-07

if [ -z "$CRON_SECRET" ]; then
  echo "[$(date)] ERROR: 未设置 CRON_SECRET，已中止" >&2
  exit 1
fi

echo "[$(date)] Generating VAT records for month: $MONTH"
docker exec "$CONTAINER" curl -s -X POST "http://localhost:3000/api/vat/records/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d "{\"month\": \"$MONTH\"}" 2>&1

echo "[$(date)] Done"
