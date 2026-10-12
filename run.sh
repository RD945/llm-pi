#!/bin/bash
# Run LLM interactively (chat mode) — optimized threads
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_CLI="$SCRIPT_DIR/llama.cpp/build/bin/llama-cli"
MODEL="${1:-$SCRIPT_DIR/models/qwen2.5-0.5b-instruct-q4_k_m.gguf}"
if [[ "$1" == *.gguf ]]; then shift; fi
exec "$LLAMA_CLI" -m "$MODEL" -t 2 -tb 4 --temp 0.7 --repeat-penalty 1.1 -c 2048 "$@"
