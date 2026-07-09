#!/bin/bash
# 数据库 + 文件备份脚本
# 用法: ./scripts/backup.sh
# 建议 cron: 0 2 * * * /path/to/project/scripts/backup.sh

set -e
cd "$(dirname "$0")/.."

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_PATH="./data.db"
UPLOADS_DIR="./uploads"
TMP_UPLOADS="/tmp/xiangtai-uploads"

mkdir -p "$BACKUP_DIR"

# 1. 备份数据库（SQLite 在线备份，safe）
echo "[$DATE] 备份数据库..."
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/data_$DATE.db'" 2>/dev/null || cp "$DB_PATH" "$BACKUP_DIR/data_$DATE.db"
echo "  -> $BACKUP_DIR/data_$DATE.db"

# 2. 备份上传文件（如果有）
for DIR in "$UPLOADS_DIR" "$TMP_UPLOADS"; do
  if [ -d "$DIR" ] && [ "$(ls -A "$DIR" 2>/dev/null)" ]; then
    TAR_NAME="uploads_${DATE}_$(basename "$DIR").tar.gz"
    tar -czf "$BACKUP_DIR/$TAR_NAME" -C "$(dirname "$DIR")" "$(basename "$DIR")" 2>/dev/null || true
    echo "  -> $BACKUP_DIR/$TAR_NAME"
  fi
done

# 3. 清理 30 天前的旧备份
find "$BACKUP_DIR" -name "data_*.db" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +30 -delete 2>/dev/null || true

echo "[$DATE] 备份完成，保留最近 30 天。"
