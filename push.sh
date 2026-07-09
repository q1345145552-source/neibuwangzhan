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

echo "✅ 搞定！已推送到 GitHub"
