#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_SERVER="$SCRIPT_DIR/llama.cpp/build/bin/llama-server"
MODEL="$SCRIPT_DIR/models/qwen2.5-0.5b-instruct-q4_k_m.gguf"
if [ -n "$1" ] && [[ "$1" == *.gguf ]]; then MODEL="$1"; fi
echo "Starting llama.cpp server (OPTIMIZED: -t 2 -tb 4 -c 2048)..."
echo "Model: $MODEL"
echo "URL: http://$(hostname -I | awk '{print $1}'):8080"
exec "$LLAMA_SERVER" -m "$MODEL" -t 2 -tb 4 -c 2048 --port 8080 --host 0.0.0.0
