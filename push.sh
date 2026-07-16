#!/bin/bash
set -e
cd "$(dirname "$0")"

MSG="${1:-优化更新}"

echo "📦 正在提交: $MSG"
git add -A
git diff --cached --quiet && echo "⚠️ 没有新改动，跳过提交" && exit 0
git commit -m "$MSG"

echo "🚀 正在推送..."
git push

# ── 部署到服务器 ──
echo ""
echo "📋 部署到服务器..."

expect -c "
set timeout 120
spawn ssh -o StrictHostKeyChecking=no root@187.127.108.58 '
    # 1. 部署前备份当前数据库
    python3 /root/backup_db.py
    echo ---BACKUP_DONE---
    
    # 2. 拉取最新代码
    cd /var/lib/docker/volumes/neibuxitong_app_data/_data
    git fetch origin main
    git reset --hard origin/main
    
    # 3. 停容器 → 清 .next 缓存 → 启动容器（CMD 自带 npm run build && npm start）
    docker stop neibuxitong
    rm -rf .next
    echo ---CLEARED_OLD_BUILD---
    docker start neibuxitong
    echo ---CONTAINER_STARTED---
    
    # 4. 等待构建完成（容器 CMD: npm run build && npm start）
    sleep 35
    docker logs neibuxitong --tail 5
    echo ---DEPLOY_DONE---
'
expect "password:" { send "RL2XuiQVsZP/" }
expect eof
" 2>&1

echo ""
echo "✅ 搞定！已备份、推送、部署完成"
