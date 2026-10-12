# Local LLM — Raspberry Pi 5 (llama.cpp + Next.js Streaming Chat)

Private, on-device streaming chat running entirely on a **Raspberry Pi 5 Model B Rev 1.1, Cortex-A76 ×4 @ 2.4 GHz, 8 GB RAM, Debian Trixie (arm64)**.

- **Model**: `Qwen2.5-0.5B-Instruct Q4_K_M` (380 MB, bartowski, GGUF) via **llama.cpp b11574**
- **Web**: **Next.js 16.4.0 + Tailwind 4 + Turbopack** (React 19.3.0) — streaming SSE, history with search/delete, live CPU graph, per-message `tok/s` stats
- **Optimized**: **`-t 2 -tb 4 -c 2048`** gives **~36 tok/s prompt, ~16 tok/s generation** — **3.5× faster** than the previous `-t 4` setup on this board
- **WiFi-ready**: both servers bind `0.0.0.0`, so any device on the same network can open `http://<pi-ip>:3000`

## Quick Start

```bash
~/llm/start-all.sh
# → Web: http://192.168.1.14:3000  (your IP: hostname -I)
# → LLM: http://192.168.1.14:8080
```

Or separately:

```bash
~/llm/start-llm.sh          # llama-server only
~/llm/start-web.sh          # Next.js only
cd ~/llm/web && LLAMA_URL=http://127.0.0.1:8080 npm run start   # production
```

CLI:

```bash
~/llm/run.sh                                 # interactive
~/llm/chat.sh "Write a haiku about Pi"       # one-shot
curl http://localhost:8080/v1/chat/completions -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

Find the Pi on your network: `hostname -I`.

## Project Layout

```
~/llm/
├── llama.cpp/                  # git clone + CMake build (build/bin/llama-*)
├── models/
│   └── qwen2.5-0.5b-instruct-q4_k_m.gguf   # 380 MB
├── web/                        # Next.js app
│   ├── src/app/page.tsx        # Chat UI + sidebar + CPU graph + stats
│   ├── src/app/api/chat/route.ts    # SSE proxy + English fix
│   ├── src/app/api/system/route.ts  # CPU/RAM/temp/load endpoint
│   ├── src/app/globals.css
│   ├── src/app/layout.tsx
│   ├── next.config.ts          # allowedDevOrigins: ["*"]
│   ├── .env.local              # LLAMA_URL=http://127.0.0.1:8080
│   └── package.json            # scripts bind 0.0.0.0:3000
├── start-all.sh                # one-command launcher (optimized)
├── start-llm.sh                # llama-server only
├── start-web.sh                # Next.js dev
├── server.sh                   # legacy llama-server wrapper
├── run.sh                      # llama-cli
├── chat.sh                     # one-shot CLI
├── download-model.sh           # Hugging Face GGUF downloader
└── README.md                   # this file
```

## Full Setup (from scratch)

Tested on **Debian Trixie**. Replace `muse` if your sudo password differs.

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

### 3) Python 3.12 (Trixie only ships 3.13 — build if needed)

Skip if `python3.12` already exists.

```bash
cd /tmp
wget -q https://www.python.org/ftp/python/3.12.10/Python-3.12.10.tgz
tar -xzf Python-3.12.10.tgz
cd Python-3.12.10
./configure --enable-optimizations --with-ensurepip=install --enable-shared --with-openssl=/usr
make -j2            # j4 OOMs on Pi 5; j2 is safe (~15 min)
echo "$PASS" | sudo -S make altinstall
echo "$PASS" | sudo -S bash -c 'echo "/usr/local/lib" > /etc/ld.so.conf.d/python312.conf && ldconfig'
python3.12 --version   # 3.12.10
python3 --version      # 3.13.5 (system)
```

### 4) cmake

```bash
pip3 install --user --break-system-packages cmake
export PATH="$HOME/.local/bin:$PATH"
cmake --version   # 4.4.4
```

### 5) llama.cpp (ARM64 Cortex-A76 optimized)

```bash
mkdir -p "$LLM"
cd "$LLM"
git clone https://github.com/ggml-org/llama.cpp.git
export PATH="$HOME/.local/bin:$PATH"
cmake -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF
cmake --build llama.cpp/build --config Release -j2   # retry -j1 if OOM
# Binaries:
#   llama.cpp/build/bin/llama-server   # HTTP server
#   llama.cpp/build/bin/llama-cli      # interactive CLI
#   llama.cpp/build/bin/llama          # unified CLI
~/llm/llama.cpp/build/bin/llama --version   # b11574
```

> `-DLLAMA_CURL=OFF` avoids libcurl dev; dotprod/NEON auto-detected for `cortex-a76+crc+crypto+dotprod`.

### 6) Model (GGUF)

`bartowski/*` is most reliable (public XET). `ggml-org/*` now requires auth when fetched via `curl`.

```bash
curl -L --progress-bar \
  "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf" \
  -o "$LLM/models/qwen2.5-0.5b-instruct-q4_k_m.gguf"
ls -lh "$LLM/models"
```

More models:

```bash
~/llm/download-model.sh bartowski/SmolLM2-1.7B-Instruct-GGUF:Q4_K_M   # ~1.0 GB
~/llm/download-model.sh bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M  # ~700 MB
~/llm/download-model.sh bartowski/Phi-3-mini-4k-instruct-GGUF:Q4_K_M # ~2.2 GB (max for 8 GB Pi)
```

### 7) Verify llama.cpp

```bash
~/llm/llama.cpp/build/bin/llama-server -m "$LLM/models/qwen2.5-0.5b-instruct-q4_k_m.gguf" -t 2 -tb 4 -c 2048 --port 8080 --host 0.0.0.0 > /tmp/llama-server.log 2>&1 &
sleep 10 && curl -s http://127.0.0.1:8080/health
curl -s -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}],"stream":false}' | python3 -m json.tool
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

> The committed `src/app/page.tsx` and `src/app/api/*` already contain history, search/delete, CPU graph, and tok/s. Just run `npm run build` after checkout.

### 9) Helper scripts

```bash
chmod +x ~/llm/*.sh
# start-llm.sh, start-web.sh, start-all.sh, run.sh, chat.sh, download-model.sh, server.sh
```

## Web UI

### Features

- **Streaming** — tokens render as they arrive (`text/event-stream`, `[DONE]` terminator)
- **History** — multiple sessions, persisted to `localStorage` (`local_llm_chats_v2`), titles auto from first user message
- **Search** — filters sessions by title and message content
- **Delete** — per-chat and per-message (trash icon, confirm dialog)
- **Clear** — current session
- **Sidebar toggle** `‹` / `☰`, collapses on mobile
- **Per-message stats** — below each assistant reply: `prompt X tok/s`, `gen Y tok/s`, `prompt→gen tokens`, total `s`, split `prompt_ms+gen_ms`
- **Live tok/s** — header badge while generating (client-estimated)
- **System panel** (sidebar footer, polled every 1 s via `GET /api/system`):
  - Sparkline (last 60 CPU samples)
  - Cards: CPU% + load1, RAM% + used, temp, uptime + live tok/s
- **Markdown lite** — code blocks, inline code, **bold**, line breaks
- **Suggestions** — 4 starter prompts when empty

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | `POST` | `{ messages:{role,content}[] }` → `text/event-stream`. Prepends English system prompt. Proxies `POST $LLAMA_URL/v1/chat/completions` with `stream:true`. Final chunk carries `timings` (prompt_n, predicted_n, prompt_ms, predicted_ms, prompt_per_second, predicted_per_second). |
| `/api/chat` | `GET` | Health — proxies `GET $LLAMA_URL/health`. |
| `/api/system` | `GET` | `{ cpu, mem:{total,used,percent}, temp:null\|number, load:[1m,5m,15m], cores, uptime }`. From `/proc/stat` delta, `/proc/meminfo`, `thermal_zone*/temp`. `Cache-Control: no-cache`. |

### Network

- `0.0.0.0:3000` (Next.js) and `0.0.0.0:8080` (llama-server) — any device on the same WiFi can open `http://<pi-ip>:3000`
- No `ufw`; `iptables` policy `ACCEPT`
- `next.config.ts` sets `allowedDevOrigins: ["*"]`

## Scripts Reference

| Script | Args | Effect |
|--------|------|--------|
| `start-all.sh` | — | `llama-server -t 2 -tb 4 -c 2048 :8080` + `next dev :3000`, waits for `/health`, traps INT/TERM |
| `start-llm.sh` | `[model.gguf]` | `llama-server -t 2 -tb 4 -c 2048 --host 0.0.0.0` |
| `start-web.sh` | — | `next dev --host 0.0.0.0 --port 3000` |
| `server.sh` | `[model] [--port N]` | `llama-server` wrapper |
| `run.sh` | `[model] [flags]` | `llama-cli -t 2 -tb 4 -c 2048 --temp 0.7` |
| `chat.sh` | `"prompt"` | one-shot via `llama-cli --no-display-prompt -n 512` |
| `download-model.sh` | `bartowski/REPO:Q4_K_M` | resolves HF filename via API then `curl -L` to `models/` |

Logs: `/tmp/llama-server.log`, `/tmp/next.log` when backgrounded.

## Benchmarks & Optimizations

### Results (Qwen2.5 0.5B Q4_K_M, Pi 5, `pp512`/`tg128`, no warmup)

`llama-bench`:

| `-t` (gen) | `-tb` (prompt) | `pp512` | `tg128` |
|------------|----------------|---------|---------|
| 4 | 4 | 60.9 | **5.3** |
| 3 | 3 | 57.5 | **13.3** |
| 2 | 2 | 42.8 | **15.6** |
| 1 | 1 | 21.5 | 11.7 |
| **2** | **4** | — | **16.2** (best) |

Live server (`/v1/chat/completions` `timings`):

| Config | prompt | generation |
|--------|--------|------------|
| `-t 4 -c 4096` | 29.5 | **4.4** |
| `-t 3 -c 2048` | 44.5 | 11.2 |
| `-t 2 -c 2048` | 41.2 | **16.4** |
| **`-t 2 -tb 4 -c 2048` (current)** | **36.2** | **15.9** |

**Why**: generation (`tg`) is memory-bound — 4 threads thrash Pi 5 LPDDR4X bandwidth. Prompt (`pp`) is batch-parallel so more threads help. Split threads (`-t 2` gen + `-tb 4` prompt) with `c=2048` KV cache gives **3.5× faster** generation than the original `-t 4 -c 4096`.

### What was tested and ruled out

- **`--flash-attn on`** — ~0% on CPU
- **`-ctk q8_0 -ctv q8_0` / `q4_0`** — 15–20% slower (keep `f16`)
- **`performance` governor** — +1–2% (already 2.4 GHz, `ondemand` is fine)
- **Vulkan / OpenBLAS** — not wired (`GGML_VULKAN=OFF`, `GGML_BLAS=OFF`); VideoCore VII Vulkan is driver-only, no compute benefit here; OpenBLAS would only help `pp`
- **`Q4_0` vs `Q4_K_M`** — similar speed, worse quality — keep `Q4_K_M`
- **Larger models** — 1.7B ≈ 8 tok/s, 3B ≈ 4 tok/s on this Pi (linear slowdown)

### Are we at max?

Yes for **CPU-only, single-user, GGUF Q4 on Cortex-A76**. Live ~16 tok/s gen is near the ceiling without a discrete GPU/NPU. To go faster:

- Smaller models: `SmolLM2-360M` (~2× faster), `TinyLlama-1.1B` (~similar)
- Lower quants: `IQ2_M` / `IQ3_M` shave RAM traffic but hurt quality — measure first
- Re-bench after any change: `llama-bench -p 512 -n 128 -r 3 -t 1,2,3,4`

### Scripts updated

All launch scripts were updated from `-t 4 -c 4096` to the optimized `-t 2 -tb 4 -c 2048`:

```
start-llm.sh, server.sh, run.sh, start-all.sh
```

`c=2048` halves the `f16` KV cache vs `4096` while still fitting long conversations on 0.5B.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot reach llama.cpp at 127.0.0.1:8080` in UI | `~/llm/start-llm.sh` or `~/llm/llama.cpp/build/bin/llama-server -m ... -t 2 -tb 4 -c 2048 --port 8080 --host 0.0.0.0 > /tmp/llama-server.log &` |
| `couldn't bind HTTP server socket, hostname: 0.0.0.0, port: 8080` | `pkill -f llama-server; sleep 2; ~/llm/start-llm.sh` or use `:8081` |
| `EADDRINUSE 0.0.0.0:3000` | `pkill -f "next-server"; cd ~/llm/web && nohup env LLAMA_URL=http://127.0.0.1:8080 npm run start > /tmp/next.log &` (or `dev`) |
| UI blank / 404 after update | `cd ~/llm/web && npm run build` then restart web |
| `你好` Chinese reply | Already fixed via English system prompt. Hard refresh `Ctrl+Shift+R`. Verify: `curl -s -X POST http://127.0.0.1:3000/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hi"}]}' --no-buffer` should stream `Hello` |
| Slow / high CPU | Already optimized to `t=2/tb=4`. Check `curl http://127.0.0.1:3000/api/system` CPU/temp. `vcgencmd get_throttled` should be `0x0`. `free -h` — keep >1 GB free |
| `python3.12: not found` | Rebuild from source per Setup §3, then `sudo ldconfig` |
| `cmake: not found` | `export PATH="$HOME/.local/bin:$PATH"` |

Logs: `/tmp/llama-server.log`, `/tmp/next.log`.
Health: `curl -s http://127.0.0.1:8080/health` → `{"status":"ok"}` ; `curl -s http://127.0.0.1:3000/api/chat` → proxy OK.

## Versions (this machine)

```
Pi:            Raspberry Pi 5 Model B Rev 1.1 (Cortex-A76 ×4 @ 2.4 GHz, 8 GB, Debian Trixie)
Linux:         6.18.50+rpt-rpi-2712
GCC:           14.2.0
cmake:         4.4.4 (pip)
llama.cpp:     b11574 (8bb3cf0d2) — Release, -DLLAMA_CURL=OFF, dotprod/NEON
Node/npm:      20.19.2 / 9.2.0
Python:        3.12.10 (built) + 3.13.5 (system) + pip 25.0.1
OpenSSL:       3.5.7 (+ libssl-dev)
GGUF:          Qwen2.5-0.5B-Instruct-Q4_K_M  380M
Next.js/TW:    16.4.0 / 4.x   React 19.3.0
Perf (live):   ~36 tok/s prompt, ~16 tok/s gen  (-t 2 -tb 4 -c 2048)
```

## Change Log

### 2026-10-13 — Optimizations & UI polish

**Benchmarks**
- Ran `llama-bench -p 512 -n 128 -r 3` at `-t 1/2/3/4` (b11574, Qwen2.5 0.5B Q4_K_M, Pi 5).
- Found gen collapse at `-t 4` (5 tok/s) due to LPDDR4X contention; `-t 2` gives ~16 tok/s.
- Split threads `-t 2 -tb 4` keeps prompt 36 tok/s and gen 16 tok/s — selected as default.

| `-t` | `-tb` | `pp512` | `tg128` (live gen) |
|------|-------|---------|---------------------|
| 4 | 4 | 60.9 | 5.3 → live 4.4 |
| 3 | 3 | 57.5 | 13.3 → live 11.2 |
| 2 | 2 | 42.8 | 15.6 → live 16.4 |
| **2** | **4** | **—** | **16.2 → live 15.9 (chosen)** |

**Ruled out**: `flash-attn` (~0%), `q8_0/q4_0` KV cache (-15%), `performance` governor (+1%), Vulkan/OpenBLAS (not applicable).

**Applied**
- Launch scripts updated from `-t 4 -c 4096` to `-t 2 -tb 4 -c 2048`: `start-llm.sh`, `server.sh`, `run.sh`, `start-all.sh`.
- `c=2048` halves KV cache vs `4096`.

**UI**
- Sidebar and per-message delete: emoji → proper trash SVG (`aria-label`, focus-visible).
- Removed `N messages` count from history items; kept timestamp.
- Verified: streaming SSE, system 1 s poll, CPU sparkline, per-message `prompt/gen tok/s + toks + ms`.

## License & Credits

- `llama.cpp` MIT (ggml-org)
- `Qwen2.5` — Alibaba Cloud (Qwen License)
- `Next.js` MIT (Vercel)
- This stack is **local-only** — no data leaves the Pi.
