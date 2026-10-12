#!/bin/bash
# Start both llama.cpp and web UI (OPTIMIZED: -t 2 -tb 4 -c 2048)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IP=$(hostname -I | awk '{print $1}')
echo "Starting Local LLM stack (OPTIMIZED)..."
echo "  Config: -t 2 -tb 4 -c 2048 (3.5x faster gen than -t 4)"
echo "  Web: http://$IP:3000"
echo "  LLM: http://$IP:8080"
echo ""
"$SCRIPT_DIR/llama.cpp/build/bin/llama-server" -m "$SCRIPT_DIR/models/qwen2.5-0.5b-instruct-q4_k_m.gguf" -t 2 -tb 4 -c 2048 --port 8080 --host 0.0.0.0 > /tmp/llama-server.log 2>&1 &
LLAMA_PID=$!
echo "llama.cpp pid $LLAMA_PID (log: /tmp/llama-server.log)"
echo -n "Waiting for llama.cpp"
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8080/health > /dev/null 2>&1; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 1
  if ! kill -0 $LLAMA_PID 2>/dev/null; then
    echo " llama.cpp failed! log:"
    cat /tmp/llama-server.log | tail -20
    exit 1
  fi
done
cd "$SCRIPT_DIR/web"
export LLAMA_URL="http://127.0.0.1:8080"
echo ""
echo "Starting web UI on http://$IP:3000 ..."
trap "kill $LLAMA_PID 2>/dev/null; exit" INT TERM
# Use dev for hot-reload + stability on Pi; use 'npm run start' for production
npm run dev &
WEB_PID=$!
wait $WEB_PID
kill $LLAMA_PID 2>/dev/null || true
