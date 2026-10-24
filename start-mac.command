#!/bin/bash
# Bấm đúp file này trên macOS để mở Post AI Studio (lần đầu: chuột phải → Mở nếu macOS chặn).
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Cần cài Node.js 20+ (https://nodejs.org hoặc: brew install node)"; read -r; exit 1; }
[ -d node_modules ] || npm install
[ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }
(sleep 2; open "http://127.0.0.1:3200") &
echo "Post AI Studio: http://127.0.0.1:3200  (đóng cửa sổ Terminal này = tắt web)"
exec node server.js
