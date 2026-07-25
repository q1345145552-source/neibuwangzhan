#!/bin/sh
# WHT monthly auto-generate — run at 00:10 on the 1st of each month
# Calls the internal API to generate records for both subtypes
#
# 需要环境变量 CRON_SECRET，且必须与应用容器里的 CRON_SECRET 一致。
# cron 示例（密钥放 /etc/xiangtai-cron.env，权限 600）：
#   10 0 1 * * . /etc/xiangtai-cron.env && /path/to/project/scripts/wht-auto-generate.sh
set -e

CONTAINER="neibuxitong"
MONTH=$(date +%Y-%m)  # current month, e.g. 2026-07

if [ -z "$CRON_SECRET" ]; then
  echo "[$(date)] ERROR: 未设置 CRON_SECRET，已中止" >&2
  exit 1
fi

echo "[$(date)] Generating WHT records for month: $MONTH"

# ภ.ง.ด.1 — 员工工资扣税
echo "[$(date)] → ภ.ง.ด.1"
docker exec "$CONTAINER" curl -s -X POST "http://localhost:3000/api/wht/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d "{\"action\": \"generate\", \"month\": \"$MONTH\", \"subtype\": \"ภ.ง.ด.1\"}" 2>&1

# ภ.ง.ด.53 — 服务费代扣税
echo "[$(date)] → ภ.ง.ด.53"
docker exec "$CONTAINER" curl -s -X POST "http://localhost:3000/api/wht/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d "{\"action\": \"generate\", \"month\": \"$MONTH\", \"subtype\": \"ภ.ง.ด.53\"}" 2>&1

echo "[$(date)] Done"
