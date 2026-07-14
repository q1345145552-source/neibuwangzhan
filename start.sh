#!/bin/bash
cd /Users/liuxiong/Desktop/internal-system
rm -f data.db-wal data.db-shm
export JWT_SECRET=xiangtai-production-jwt-2026
echo "Starting server on http://localhost:3000 ..."
npx next start -p 3000
