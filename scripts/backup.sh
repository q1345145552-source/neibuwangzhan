#!/bin/bash
# Consistent database path + online SQLite snapshot + attachment archives.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_ROOT="$PWD"
DB_HELPER="$APP_ROOT/scripts/backup-source.cjs"
# Source preflight happens before backup directory creation, never auto-creates a DB.
DB_PATH=$(node "$DB_HELPER" path) || exit 10
BACKUP_DIR="${BACKUP_DIR:-$APP_ROOT/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
UPLOADS_DIR="${UPLOADS_DIR:-$APP_ROOT/uploads}"
FILES_DIR="${FILES_DIR:-$APP_ROOT/files}"
TMP_UPLOADS="${TMP_UPLOADS:-/tmp/xiangtai-uploads}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
LOCK_DIR="$BACKUP_DIR/backup.lock.d"
mkdir "$LOCK_DIR" 2>/dev/null || { echo "Backup already running: $LOCK_DIR" >&2; exit 1; }
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
umask 077
DB_BACKUP="$BACKUP_DIR/data_$DATE.db"
[ ! -e "$DB_BACKUP" ] || { echo 'Backup timestamp already exists' >&2; exit 1; }
echo "[$DATE] 备份数据库..."
node "$DB_HELPER" backup "$DB_BACKUP" > "$BACKUP_DIR/data_$DATE.json"
# Never copy a live SQLite file as a fallback. Any DB or attachment error exits
# before retention cleanup, leaving all older recovery points untouched.
for ENTRY in "uploads:$UPLOADS_DIR" "files:$FILES_DIR" "temporary:$TMP_UPLOADS"; do
  LABEL="${ENTRY%%:*}"
  DIR="${ENTRY#*:}"
  if [ -d "$DIR" ]; then
    tar -czf "$BACKUP_DIR/uploads_${DATE}_${LABEL}.tar.gz" -C "$(dirname "$DIR")" "$(basename "$DIR")"
    tar -tzf "$BACKUP_DIR/uploads_${DATE}_${LABEL}.tar.gz" >/dev/null
  fi
done
find "$BACKUP_DIR" -name 'data_*.db' -mtime +30 -delete
find "$BACKUP_DIR" -name 'data_*.json' -mtime +30 -delete
find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -mtime +30 -delete
echo "[$DATE] 备份完成（已校验业务库，附件打包成功），保留最近 30 天。"
