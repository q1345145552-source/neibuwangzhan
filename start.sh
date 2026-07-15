#!/bin/sh
cd /app
export JWT_SECRET=xiangtai-production-jwt-2026
echo Starting Xiangtai on port 3000...
exec npx next start -p 3000
