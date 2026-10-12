#!/bin/bash
# One-shot prompt: ./chat.sh "your question here"
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_CLI="$SCRIPT_DIR/llama.cpp/build/bin/llama-cli"
MODEL="$SCRIPT_DIR/models/qwen2.5-0.5b-instruct-q4_k_m.gguf"

if [ $# -eq 0 ]; then
  echo "Usage: ./chat.sh \"your prompt here\""
  echo "   or: echo \"prompt\" | ./chat.sh"
  exit 1
fi

PROMPT="$*"
echo "$PROMPT" | "$LLAMA_CLI" -m "$MODEL" -t 4 --no-display-prompt -n 512 --temp 0.7 -c 4096 2>/dev/null | sed '/^> /d' | sed '/^\[ Prompt:/d' | sed '/^Exiting/d' | sed '/^$/d' | grep -v "^\s*$"
