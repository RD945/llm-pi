#!/bin/bash
# Run LLM as OpenAI-compatible HTTP server on port 8080
# Usage: ./server.sh [model.gguf] [--port 8080]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_SERVER="$SCRIPT_DIR/llama.cpp/build/bin/llama-server"
MODEL="$SCRIPT_DIR/models/qwen2.5-0.5b-instruct-q4_k_m.gguf"
PORT="8080"
while [[ $# -gt 0 ]]; do
  case "$1" in
    *.gguf) MODEL="$1"; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) break ;;
  esac
done
echo "Starting server on http://localhost:$PORT (OPTIMIZED: -t 2 -tb 4 -c 2048)"
echo "Model: $MODEL"
exec "$LLAMA_SERVER" -m "$MODEL" -t 2 -tb 4 -c 2048 --port "$PORT" --host 0.0.0.0 "$@"
