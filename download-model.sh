#!/bin/bash
# Download GGUF models from Hugging Face
# Usage: ./download-model.sh bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M
#        ./download-model.sh TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF:tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$SCRIPT_DIR/models"

if [ $# -eq 0 ]; then
  echo "Usage: ./download-model.sh <hf-repo>[:quant|:filename]"
  echo "Examples:"
  echo "  ./download-model.sh bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M"
  echo "  ./download-model.sh bartowski/SmolLM2-1.7B-Instruct-GGUF:Q4_K_M"
  echo "  ./download-model.sh TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF:tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
  echo ""
  echo "Recommended for this Pi (8GB):"
  echo "  Qwen2.5-0.5B Q4_K_M  ~380MB  (current)"
  echo "  SmolLM2-1.7B Q4_K_M  ~1.0GB"
  echo "  Llama-3.2-1B Q4_K_M  ~700MB"
  echo "  Phi-3-mini  Q4_K_M   ~2.2GB  (max recommended)"
  exit 1
fi

REPO="$1"
# Parse repo:quant or repo:filename
HF_REPO=""
HF_FILE=""
if [[ "$REPO" == *":"* ]]; then
  HF_REPO="${REPO%%:*}"
  QUANT="${REPO##*:}"
  if [[ "$QUANT" == *.gguf ]]; then
    HF_FILE="$QUANT"
  else
    # Try to discover filename - construct common pattern
    HF_FILE=""
    echo "Quant: $QUANT (will auto-resolve)"
  fi
else
  HF_REPO="$REPO"
fi

# Convert repo name to expected filename pattern if no explicit file
if [ -z "$HF_FILE" ] && [ -n "$QUANT" ]; then
  # List files via HF API to find matching quant
  echo "Resolving $QUANT in $HF_REPO..."
  FILES=$(curl -s "https://huggingface.co/api/models/$HF_REPO" | grep -o '"rfilename":"[^"]*\.gguf"' | sed 's/"rfilename":"//;s/"//' | grep -i "$QUANT" | head -5)
  if [ -z "$FILES" ]; then
    echo "Could not find $QUANT file. Available GGUF files:"
    curl -s "https://huggingface.co/api/models/$HF_REPO" | grep -o '"rfilename":"[^"]*\.gguf"' | sed 's/"rfilename":"//' | tr -d '"' | head -20
    exit 1
  fi
  HF_FILE=$(echo "$FILES" | head -1)
  echo "Found: $HF_FILE"
fi

if [ -z "$HF_FILE" ]; then
  # No quant specified, list options
  echo "Available GGUF files in $HF_REPO:"
  curl -s "https://huggingface.co/api/models/$HF_REPO" | grep -o '"rfilename":"[^"]*\.gguf"' | sed 's/"rfilename":"//' | tr -d '"' | head -20
  exit 1
fi

URL="https://huggingface.co/$HF_REPO/resolve/main/$HF_FILE"
OUT="$MODELS_DIR/$HF_FILE"
echo "Downloading: $URL"
echo "       To: $OUT"
curl -L --progress-bar "$URL" -o "$OUT"
echo "Done: $(du -h "$OUT" | cut -f1) -> $OUT"
