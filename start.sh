#!/bin/bash
cd "$(dirname "$0")"
export JWT_SECRET=xiangtai-production-jwt-2026
echo "正在启动湘泰系统..."
npx next start -p 3000
