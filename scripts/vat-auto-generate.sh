#!/bin/sh
# VAT monthly auto-generate — run at 00:05 on the 1st of each month
# Calls the internal API to generate records for all enabled customers
set -e

CONTAINER="neibuxitong"
MONTH=$(date +%Y-%m)  # current month, e.g. 2026-07

echo "[$(date)] Generating VAT records for month: $MONTH"
docker exec "$CONTAINER" curl -s -X POST "http://localhost:3000/api/vat/records/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer internal-cron" \
  -d "{\"month\": \"$MONTH\"}" 2>&1

echo "[$(date)] Done"
