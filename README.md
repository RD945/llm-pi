# Local LLM — Raspberry Pi 5

> **Streaming chat, 100% on-device.** No cloud, no API keys, no data leaving the Pi.
> Built for **Raspberry Pi 5 Rev 1.1 (Cortex-A76 ×4 @ 2.4 GHz, 8 GB LPDDR4X, Debian 13 Trixie)** but adapts to any Linux/arm64 or x86_64 box.

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.4-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/llama.cpp-b11574-blue" alt="llama.cpp" />
  <img src="https://img.shields.io/badge/Raspberry%20Pi-5-red" alt="Pi" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

A complete, private LLM stack that runs entirely on a Raspberry Pi — no cloud calls, no API keys, and no data leaving the device. It pairs a quantized language model served by llama.cpp with a fast, streaming Next.js chat interface that works from any phone or laptop on the same WiFi. Built and benchmarked on a Pi 5, but the setup adapts to any Linux machine.

---

## What it is

A complete, private LLM stack:

- **Model**: `Qwen2.5-0.5B-Instruct Q4_K_M` (380 MB, bartowski, GGUF) — instruction-tuned, multilingual but forced to English for this UI.
- **Inference**: **llama.cpp** built from source (b11574, `Release`, dotprod/NEON on Cortex-A76, `-DLLAMA_CURL=OFF`). No GPU, no Vulkan, pure CPU.
- **Web**: **Next.js 16 + Tailwind 4 + Turbopack** (React 19). Streams tokens as they generate, keeps history, shows live system metrics and per-message `tok/s`.
- **Network**: both servers bind `0.0.0.0` — open `http://<pi-ip>:3000` from any phone/laptop on the same WiFi.
- **Tuned**: **`-t 2 -tb 4 -c 2048`** gives **~36 tok/s prompt, ~16 tok/s generation** — 3.5× faster than the naïve `-t 4` on this board.

The whole thing fits in `~/llm`, rebuilds from git, and leaves no secrets in the repo (`.gitignore` excludes `models/*.gguf`, `llama.cpp/build`, `node_modules`, `.env.local`).

---

## Demo

```bash
~/llm/start-all.sh
# open on any device: http://192.168.1.14:3000
```

<div align="center">

*Chat with streaming, history, search, delete. Left sidebar shows live CPU sparkline and RAM/temp.*

| User bubble (dark) | Assistant bubble (white, markdown) | Per-message stats |
|---|---|---|
| `Hello!` → streamed tokens | Code blocks, inline code, **bold** | `prompt 36.2 tok/s · gen 15.9 tok/s · 30→41 tok · 3.27s` |

</div>

---

## Features

### Chat core

- **Token streaming (SSE)** — `POST /api/chat` proxies `POST $LLAMA_URL/v1/chat/completions` (`stream:true`, OpenAI-compatible `text/event-stream`) and renders chunks as they arrive. Live header badge shows `~tok/s` while generating.
- **English enforcement** — Qwen replies Chinese for short prompts like `hi` if no system prompt is set. The server injects `"You are a helpful assistant. Always respond in English."` when the client didn't already send a `system` message.
- **Markdown lite** — ```` code blocks, `inline code`, **bold**, line breaks; no extra deps.
- **Suggestions** — 4 starter prompts when no messages (`Explain quantum computing…`, `Write a haiku…`, etc.).
- **Stop** — aborts the fetch mid-stream and removes the placeholder.

### History & search

- **Multi-session** — each chat is a `ChatSession { id, title, messages, createdAt, updatedAt }`.
- **Persistence** — `localStorage` key `local_llm_chats_v2`; survives refresh, no backend DB.
- **Titles** — auto from first user message (48 char clipped).
- **Search** — filters sessions by title **and** message content (case-insensitive).
- **Delete** — per-chat (sidebar trash icon, confirm) and per-message (message trash icon, confirm). `Clear` wipes current session.
- **Sidebar toggle** `‹` / `☰`; collapses on mobile.

### Observability

- **System panel** (sidebar footer, polled every 1 s via `GET /api/system`):
  - **Sparkline** — last 60 CPU% samples (160×48 SVG, emerald line + fill).
  - **Cards**: CPU% + `load[0]`, RAM% + used, Temp (°C) + total RAM, Uptime + live `tok/s`.
- **Per-message stats** — after each assistant reply, badges from llama.cpp `timings`:
  - `prompt X tok/s`, `gen Y tok/s`, `prompt→gen tokens`, total `s`, split `prompt_ms+gen_ms`.
- **Header** — `● ready` / `● 15.9 tok/s` while generating.

---

## Architecture

```
                ┌──────────────┐  SSE (proxy)  ┌──────────────┐  OpenAI SSE  ┌──────────────┐
 Browser  ◄───► │   Next.js    │ ◄───────────► │  llama.cpp   │ ◄───────────►│  GGUF model  │
  :3000         │  /api/chat   │               │  :8080       │              │  Qwen 0.5B   │
                │  /api/system │──── /proc ───►│              │              │  Q4_K_M      │
                └──────────────┘               └──────────────┘              └──────────────┘
                        │  localStorage (history)         │ thread pool (-t 2, -tb 4)
                        └─────────────────────────────────┘
```

- **`POST /api/chat`** — validates `messages`, injects English system prompt, forwards to llama.cpp with `stream:true`, returns `text/event-stream` (`data: {...}\n\n`, `data: [DONE]`). Final llama chunk carries `timings` (`prompt_n`, `predicted_n`, `prompt_ms`, `predicted_ms`, `prompt_per_second`, `predicted_per_second`).
- **`GET /api/chat`** — health (`GET $LLAMA_URL/health`).
- **`GET /api/system`** — reads `/proc/stat` delta for CPU%, `/proc/meminfo`, `thermal_zone*/temp`, `os.loadavg()`, `os.cpus()`. `Cache-Control: no-cache`.

---

## Project Layout

```
~/llm/
├── llama.cpp/                  # git submodule ggml-org/llama.cpp (b11574); build in build/
├── models/
│   ├── .gitkeep                # tracked so the folder exists; *.gguf ignored
│   └── qwen2.5-0.5b-instruct-q4_k_m.gguf   # 380 MB (not in repo; curl to fetch)
├── web/                        # Next.js app
│   ├── src/app/page.tsx        # Chat UI (streaming, history, CPU graph, stats)
│   ├── src/app/api/chat/route.ts    # SSE proxy + English fix
│   ├── src/app/api/system/route.ts  # CPU/RAM/temp/load
│   ├── src/app/globals.css
│   ├── src/app/layout.tsx
│   ├── next.config.ts          # allowedDevOrigins: ["*"], 0.0.0.0 binds via package.json scripts
│   ├── .env.local              # LLAMA_URL=http://127.0.0.1:8080 (ignored, see .env.example)
│   ├── .env.example            # template
│   ├── package.json            # dev/start both --hostname 0.0.0.0 --port 3000
│   └── public/                 # Next/Vercel SVGs
├── start-all.sh                # one-command launcher (optimized, health checks, trap)
├── start-llm.sh                # llama-server only
├── start-web.sh                # Next.js dev
├── server.sh                   # legacy llama-server wrapper
├── run.sh                      # llama-cli
├── chat.sh                     # one-shot CLI (llama-cli --no-display-prompt)
├── download-model.sh           # HF GGUF downloader (bartowski/*)
├── .gitignore
├── .gitmodules
└── README.md                   # this file
```

---

## Quick Start

Requires the model to already be at `models/*.gguf` and `web/.next` built (see Full Setup).

```bash
~/llm/start-all.sh
# → Web: http://192.168.1.14:3000   (your IP: hostname -I)
# → LLM: http://192.168.1.14:8080
```

Or run each side separately:

```bash
~/llm/start-llm.sh
~/llm/start-web.sh
# production (after npm run build):
cd ~/llm/web && LLAMA_URL=http://127.0.0.1:8080 npm run start
```

CLI and raw API:

```bash
~/llm/run.sh                                    # interactive llama-cli
~/llm/chat.sh "Write a haiku about Pi"          # one-shot (-n 512)

# OpenAI-compatible API (llama.cpp direct):
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# via Next.js (SSE, with English fix):
curl -N http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'

# system stats:
curl http://localhost:3000/api/system | python3 -m json.tool
```

Find the Pi on your network: `hostname -I`.

---

## Full Setup (from scratch)

Tested on **Debian 13 Trixie (arm64)**. Replace `muse` if your sudo password differs.

### 1) Paths

```bash
export PASS="muse"
export LLM="$HOME/llm"
mkdir -p "$LLM/models"
```

### 2) System packages

```bash
echo "$PASS" | sudo -S apt-get update
echo "$PASS" | sudo -S apt-get install -y \
  nodejs npm \
  libssl-dev \
  python3-pip python3-venv python3-full \
  build-essential curl wget git \
  libssl-dev libffi-dev libncurses-dev libsqlite3-dev libreadline-dev \
  tk-dev libnss3-dev libbz2-dev libexpat1-dev liblzma-dev zlib1g-dev \
  uuid-dev libgdbm-dev libgdbm-compat-dev

node --version   # 20.19.2
npm --version    # 9.2.0
openssl version  # 3.5.7
```

Install notes:
- `nodejs` 20 + `npm` 9 come from Trixie repos; no nodesource needed.
- `libssl-dev` is required twice (once for `python3.12 --with-openssl`, once for any native addons), hence listed explicitly.

### 3) Python 3.12 (Trixie only ships 3.13 — build if needed)

Skip if `python3.12 --version` already works. Trixie has `python3.13` (3.13.5) but not `3.12`; some tooling expects 3.12.

```bash
cd /tmp
wget -q https://www.python.org/ftp/python/3.12.10/Python-3.12.10.tgz
tar -xzf Python-3.12.10.tgz
cd Python-3.12.10
./configure --enable-optimizations --with-ensurepip=install --enable-shared --with-openssl=/usr
make -j2            # j4 OOMs on Pi 5 (8 GB); j2 is safe (~15 min)
echo "$PASS" | sudo -S make altinstall
echo "$PASS" | sudo -S bash -c 'echo "/usr/local/lib" > /etc/ld.so.conf.d/python312.conf && ldconfig'
python3.12 --version   # 3.12.10
python3 --version      # 3.13.5 (system)
```

### 4) cmake (pip wheel — Trixie has no cmake apt package on arm64 by default)

```bash
pip3 install --user --break-system-packages cmake
export PATH="$HOME/.local/bin:$PATH"
cmake --version   # 4.4.4
```

### 5) llama.cpp (ARM64 Cortex-A76 optimized)

```bash
mkdir -p "$LLM"
cd "$LLM"
git clone https://github.com/ggml-org/llama.cpp.git   # or git submodule add ... if this is a clone of llm-pi
export PATH="$HOME/.local/bin:$PATH"
cmake -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF
cmake --build llama.cpp/build --config Release -j2   # retry -j1 if OOM
# Binaries:
#   llama.cpp/build/bin/llama-server   # HTTP server (OpenAI-compatible)
#   llama.cpp/build/bin/llama-cli      # interactive CLI
#   llama.cpp/build/bin/llama          # unified CLI (serve/cli/download)
~/llm/llama.cpp/build/bin/llama --version   # 0.6.0-dev b11574 (8bb3cf0d2)
```

Build details:
- `-DLLAMA_CURL=OFF` avoids `libcurl` dev; download uses `curl` externally.
- CMake auto-detects `cortex-a76+crc+crypto+dotprod+noi8mm+nosve+nosme` and enables dotprod/NEON.
- `Release` gives `-O3 -DNDEBUG`; no Vulkan (`GGML_VULKAN=OFF`), no BLAS (`GGML_BLAS=OFF`), `OPENMP=ON`, `ACCELERATE=ON`.

### 6) Model (GGUF)

`bartowski/*` is most reliable (public XET bridge). `ggml-org/*` now 401s without a token when fetched via raw `curl`.

```bash
curl -L --progress-bar \
  "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf" \
  -o "$LLM/models/qwen2.5-0.5b-instruct-q4_k_m.gguf"
ls -lh "$LLM/models"   # 380M
```

More models (same host, same pattern):

```bash
~/llm/download-model.sh bartowski/SmolLM2-1.7B-Instruct-GGUF:Q4_K_M   # ~1.0 GB
~/llm/download-model.sh bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M  # ~700 MB
~/llm/download-model.sh bartowski/Phi-3-mini-4k-instruct-GGUF:Q4_K_M # ~2.2 GB (max for 8 GB Pi)
```

`download-model.sh` resolves the filename via `https://huggingface.co/api/models/<repo>` and `curl -L`s to `models/`.

### 7) Verify llama.cpp

```bash
~/llm/llama.cpp/build/bin/llama-server -m "$LLM/models/qwen2.5-0.5b-instruct-q4_k_m.gguf" -t 2 -tb 4 -c 2048 --port 8080 --host 0.0.0.0 > /tmp/llama-server.log 2>&1 &
sleep 10 && curl -s http://127.0.0.1:8080/health   # {"status":"ok"}
curl -s -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}' | python3 -m json.tool

# Interactive CLI:
echo "Write a haiku about Raspberry Pi" | ~/llm/llama.cpp/build/bin/llama-cli \
  -m "$LLM/models/qwen2.5-0.5b-instruct-q4_k_m.gguf" -t 2 -tb 4 -c 2048 --no-display-prompt -n 100
```

### 8) Web UI

```bash
mkdir -p "$LLM/web"
cd "$LLM/web"
npx --yes create-next-app@latest . --typescript --eslint --tailwind --app --src-dir --import-alias "@/*" --use-npm
npm install ai
echo 'LLAMA_URL=http://127.0.0.1:8080' > .env.local
npm run build
```

When cloning an existing `llm-pi` repo, steps simplify to:

```bash
git clone --recurse-submodules https://github.com/RD945/llm-pi.git ~/llm
cd ~/llm/web && npm install && npm run build
```

The committed `src/app/page.tsx` and `src/app/api/*` already implement streaming, history, CPU graph, and tok/s.

### 9) Helper scripts

```bash
chmod +x ~/llm/*.sh
# start-llm.sh  — llama-server only (optimized)
# start-web.sh  — Next.js dev
# start-all.sh  — both with health checks + trap
# run.sh        — llama-cli
# chat.sh       — one-shot
# download-model.sh
# server.sh     — legacy llama-server wrapper
```

---

## Web UI Guide

### Using it

1. **Pick a suggestion** (4 cards when empty) or type in the bottom box. `Enter` sends, `Shift+Enter` newline.
2. **Streaming** — tokens appear live; header turns `● 15.9 tok/s` while generating; `Stop` cancels.
3. **After each assistant reply**, badges show:
   - `prompt 36.2 tok/s`, `gen 15.9 tok/s` (from llama.cpp `timings`)
   - `30→41 tok` (prompt vs generated)
   - `3.27s` total, `807+2464 ms` split
4. **History** — left sidebar lists all sessions (title + time). Click to switch.
5. **Search** — filters by title and message content.
6. **Delete** — trash icon on hover (chat or message) → confirm.
7. **System** — sparkline + 4 cards (CPU/load, RAM/used, temp, uptime) updating every second.

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | `POST` | `{ messages:{role,content}[] }` → `text/event-stream`. Injects English system prompt. Proxies `POST $LLAMA_URL/v1/chat/completions` (`stream:true`). Final SSE chunk carries `timings` (prompt_n, predicted_n, prompt_ms, predicted_ms, prompt_per_second, predicted_per_second) parsed for stats. |
| `/api/chat` | `GET` | Health — proxies `GET $LLAMA_URL/health`. |
| `/api/system` | `GET` | `{ cpu, mem:{total,used,percent}, temp:null\|number, load:[1m,5m,15m], cores, uptime }`. Reads `/proc/stat` (delta), `/proc/meminfo`, `thermal_zone*/temp`, `os.loadavg()`. `Cache-Control: no-cache`. |

### Cool details

- CORS bypass: browser never hits `:8080` directly — Next.js proxies it, so you don't need to expose llama.cpp publicly.
- Frontend SSE parser splits on `\n\n` boundaries, handles partial lines, captures `event: timings` or inline `timings` field in the last token chunk.
- `localStorage` size limit (~5 MB) fits hundreds of chats (messages are text only).
- `.env.local` is `.gitignore`d; `.env.example` is tracked.

---

## Scripts Reference

| Script | Args | Effect |
|--------|------|--------|
| `start-all.sh` | — | `llama-server -t 2 -tb 4 -c 2048 :8080` + `next dev :3000`, waits for `/health`, `trap` on INT/TERM |
| `start-llm.sh` | `[model.gguf]` | `llama-server -t 2 -tb 4 -c 2048 --host 0.0.0.0` (switch `-t`/`-tb`/`-c` if you re-bench) |
| `start-web.sh` | — | `next dev --host 0.0.0.0 --port 3000` (installs `node_modules` if missing) |
| `server.sh` | `[model] [--port N]` | `llama-server` wrapper with optimization flags |
| `run.sh` | `[model] [flags]` | `llama-cli -t 2 -tb 4 -c 2048 --temp 0.7` |
| `chat.sh` | `"prompt"` | one-shot: `llama-cli --no-display-prompt -n 512` |
| `download-model.sh` | `bartowski/REPO:Q4_K_M` | resolves HF filename via `huggingface.co/api/models/<repo>` then `curl -L` to `models/` |

Logs: `/tmp/llama-server.log`, `/tmp/next.log` when backgrounded.

---

## Configuration

### Threading & context

Edit all four launch scripts when changing:

```bash
# in start-llm.sh, server.sh, run.sh, start-all.sh:
-t 2 -tb 4 -c 2048
#  ^  ^     ^
#  |  |     └─ context length (tokens). 2048 is plenty for 0.5B; 4096 halves tok/s slightly.
#  |  └─ batch threads (prompt). Higher helps prompt eval (batched matmul).
#  └─ gen threads (decode). Lower helps on Pi memory bandwidth. This is the dominant knob.
```

Also in `llama-bench`: `-t`, `-tb`, `-c`, `-p`/`-n` map to the same.

### Model switch

```bash
~/llm/download-model.sh bartowski/SmolLM2-1.7B-Instruct-GGUF:Q4_K_M
~/llm/run.sh ~/llm/models/SmolLM2-1.7B-Instruct-Q4_K_M.gguf     # or edit start-*.sh MODEL=
```

### Port/host

- llama.cpp: `--port 8080 --host 0.0.0.0` (change and update `web/.env.local` `LLAMA_URL` + `start-all.sh` health check URL)
- Next.js: `--port 3000 --hostname 0.0.0.0` (in `web/package.json` `dev`/`start` scripts)

### English fix

In `web/src/app/api/chat/route.ts`:

```ts
const SYSTEM_EN = "You are a helpful assistant. Always respond in English.";
const withSystem = messages[0]?.role === "system" ? messages : [{ role: "system", content: SYSTEM_EN }, ...messages];
```

Remove or change language there.

---

## Models

| Repo | Quant | Size | On Pi 5 (est. gen tok/s) |
|------|-------|------|---------------------------|
| **Qwen2.5 0.5B Instruct** (current) | Q4_K_M | **380 MB** | **~16** |
| SmolLM2 360M | Q4_K_M | ~240 MB | ~25 |
| TinyLlama 1.1B | Q4_K_M | ~670 MB | ~10 |
| Llama 3.2 1B | Q4_K_M | ~700 MB | ~10 |
| SmolLM2 1.7B | Q4_K_M | ~1.0 GB | ~8 |
| Phi-3 mini 3.8B | Q4_K_M | ~2.2 GB | ~4 |

Linear: ~doubles size ≈ halves `tok/s`. Measure with `llama-bench` before committing.

---

## Optimizations & Benchmarks

This section documents **every experiment run on this Pi** so you can reproduce or extend it.

### Why optimize

On launch the server used `-t 4 -c 4096` (all 4 cores, full context) — intuitive but **slowest** for generation. On a memory-bound decoder, more threads ≈ more contention.

### Method

#### `llama-bench` (synthetic, no warmup, isolated)

```bash
~/llm/llama.cpp/build/bin/llama-bench -m ~/llm/models/qwen2.5-0.5b-instruct-q4_k_m.gguf -p 512 -n 128 -r 3 --no-warmup -t N
```

- `-p 512` prompt tokens, `-n 128` generated tokens — separates `pp512` (prompt processing) from `tg128` (text generation)
- `-r 3` repetitions, `--no-warmup` for cold, averaged ± stddev
- `-t N` gen threads (`-tb` not supported in bench, so prompt vs gen split tested separately via live server)

#### Live server (real streaming)

```bash
curl -s -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}' | python3 -c "import sys,json; d=json.load(sys.stdin)['timings']; print(d)"
# fields: prompt_n, prompt_ms, prompt_per_second, predicted_n, predicted_ms, predicted_per_second
```

- Single slot, `c` as configured, flash-attn auto, `f16` KV cache unless noted

### Results

#### Bench

| `-t` (gen threads) | `pp512` (prompt tok/s) | `tg128` (gen tok/s) |
|---------------------|------------------------|----------------------|
| 4 | 60.9 | **5.3** |
| 3 | 57.5 | **13.3** |
| 2 | 42.8 | **15.6** |
| 1 | 21.5 | 11.7 |
| 2(tb 4 not benchable) | — | **16.2** (via live server combo) |

#### Live

| Config | prompt | generation |
|--------|--------|------------|
| `-t 4 -c 4096` | 29.5 | **4.4** |
| `-t 3 -c 2048` | **44.5** | 11.2 |
| `-t 2 -c 2048` | 41.2 | **16.4** |
| **`-t 2 -tb 4 -c 2048` (current)** | **36.2** | **15.9** |

**Interpretation**

- `pp` (prompt) is **compute-bound** (batched matmul) — more threads help (≈ +40% from 2→4).
- `tg` (decode) is **memory-bound** (one token at a time, KV cache streaming) — more threads thrash LPDDR4X (~17 GB/s on Pi 5). **Fewer gen threads win**.
- Split `-t 2 -tb 4` keeps `pp` high without hurting `tg`. `c=2048` vs `4096` halves `f16` KV cache (≈ 1 MB at 0.5B), keeps gen fast while still fitting long chats.
- **3.5×** generation speed-up vs original `-t 4 -c 4096`.

### Also tested (ruled out)

| Experiment | Result | Decision |
|------------|--------|----------|
| `--flash-attn on` | +0.5 pp, −0.2 tg | Leave `auto` |
| `-ctk q8_0 -ctv q8_0` | −15% both pp/tg | Keep `f16` |
| `-ctk q4_0 -ctv q4_0` | −10% both | Keep `f16` |
| `performance` governor (`echo performance > .../scaling_governor`) | +1–2% (already 2.4 GHz) | Keep `ondemand` |
| `GGML_VULKAN=ON` / Broadcom V3D Vulkan | No device listed (`llama-bench --list-devices` → `(none)`); Pi 5 VideoCore VII Vulkan is driver-only, no compute | Not applicable |
| `GGML_BLAS=ON` + OpenBLAS | Not built; would only help `pp`, not `tg` | Not installed |
| `Q4_0` vs `Q4_K_M` quant (same model) | Similar `tg`, worse quality | Keep `Q4_K_M` |
| Larger models (1.7B, 3.8B) | ~8 tok/s, ~4 tok/s (linear slowdown) | Possible but slower |

### Is this the max?

**Yes for CPU-only, single-user, GGUF Q4 on Cortex-A76.** Live ~16 tok/s gen is near the ceiling without a discrete GPU/NPU. To go faster:

- Smaller/distilled: `SmolLM2-360M` (~2× faster), `TinyLlama-1.1B` (~similar).
- Lower quants: `IQ2_M` / `IQ3_M` shave RAM traffic but degrade quality — bench before committing.
- Rigorous: after any change, re-run `llama-bench -p 512 -n 128 -r 3 -t 1,2,3,4` and one live `curl` test, keep `-c 2048` for comparison.

---
