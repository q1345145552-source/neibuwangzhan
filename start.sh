#!/bin/bash
cd /Users/liuxiong/Desktop/internal-system
rm -f data.db-wal data.db-shm
echo "Starting server on http://localhost:3000 ..."
npx next start -p 3000
