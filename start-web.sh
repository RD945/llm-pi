#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"
IP=$(hostname -I | awk '{print $1}')
echo "Starting Next.js web UI..."
echo "Local:   http://localhost:3000"
echo "Network: http://$IP:3000  (open this on any device on same WiFi)"
echo "LLM API: $IP:8080 (proxied via /api/chat)"
cd "$WEB_DIR"
# Ensure deps
if [ ! -d node_modules ]; then npm install; fi
export LLAMA_URL="http://127.0.0.1:8080"
exec npm run dev
