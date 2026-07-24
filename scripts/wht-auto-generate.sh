#!/bin/sh
# WHT monthly auto-generate — run at 00:10 on the 1st of each month
# Calls the internal API to generate records for both subtypes
set -e

CONTAINER="neibuxitong"
MONTH=$(date +%Y-%m)  # current month, e.g. 2026-07

echo "[$(date)] Generating WHT records for month: $MONTH"

# ภ.ง.ด.1 — 员工工资扣税
echo "[$(date)] → ภ.ง.ด.1"
docker exec "$CONTAINER" curl -s -X POST "http://localhost:3000/api/wht/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer internal-cron" \
  -d "{\"action\": \"generate\", \"month\": \"$MONTH\", \"subtype\": \"ภ.ง.ด.1\"}" 2>&1

# ภ.ง.ด.53 — 服务费代扣税
echo "[$(date)] → ภ.ง.ด.53"
docker exec "$CONTAINER" curl -s -X POST "http://localhost:3000/api/wht/records" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer internal-cron" \
  -d "{\"action\": \"generate\", \"month\": \"$MONTH\", \"subtype\": \"ภ.ง.ด.53\"}" 2>&1

echo "[$(date)] Done"
