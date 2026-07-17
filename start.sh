#!/bin/sh
set -e
cd /app

# Create data directory symlinks (data/ is a Docker bind mount, never in git)
mkdir -p /app/data/uploads /app/data/files
ln -sf /app/data/data.db /app/data.db 2>/dev/null || true
ln -sf /app/data/uploads /app/uploads 2>/dev/null || true
ln -sf /app/data/files /app/files 2>/dev/null || true

export JWT_SECRET=xiangtai-production-jwt-2026
echo "Starting Xiangtai on port 3000..."
exec npx next start -p 3000
