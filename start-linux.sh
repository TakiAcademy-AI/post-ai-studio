#!/bin/bash
# Linux: chạy nền (không tắt khi đóng terminal), log ở data/server.log.
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }
mkdir -p data
setsid nohup node server.js >> data/server.log 2>&1 < /dev/null &
echo "Post AI Studio: http://127.0.0.1:3200 (log: data/server.log)"
