"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";

// ---- types ----
type Message = {
  role: "user" | "assistant";
  content: string;
  stats?: MsgStats;
};

type MsgStats = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_ms?: number;
  predicted_ms?: number;
  prompt_tps?: number;
  predicted_tps?: number;
  total_ms?: number;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

type SystemStats = {
  cpu: number;
  mem: { total: number; used: number; percent: number };
  temp: number | null;
  load: number[];
  cores: number;
  uptime: number;
};

// ---- helpers ----
const STORAGE_KEY = "local_llm_chats_v2";
const SUGGESTIONS = [
  "Explain quantum computing simply",
  "Write a haiku about Raspberry Pi",
  "Give me a healthy dinner recipe",
  "Tell a short sci-fi story",
];

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function titleFromMessages(msgs: Message[]) {
  const firstUser = msgs.find((m) => m.role === "user")?.content ?? "New chat";
  return firstUser.slice(0, 48).trim() + (firstUser.length > 48 ? "…" : "");
}

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---- markdown ----
function MarkdownLite({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let key = 0;
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const renderInline = (t: string, k: number) => {
    const nodes: React.ReactNode[] = [];
    const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let idx = 0;
    let m: RegExpExecArray | null;
    let innerKey = 0;
    while ((m = inlineRegex.exec(t)) !== null) {
      if (m.index > idx) nodes.push(<span key={innerKey++}>{t.slice(idx, m.index)}</span>);
      if (m[0].startsWith("`")) {
        nodes.push(
          <code key={innerKey++} className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-800 text-[13px] font-mono border">
            {m[0].slice(1, -1)}
          </code>
        );
      } else {
        nodes.push(<strong key={innerKey++} className="font-semibold">{m[0].slice(2, -2)}</strong>);
      }
      idx = m.index + m[0].length;
    }
    if (idx < t.length) nodes.push(<span key={innerKey++}>{t.slice(idx)}</span>);
    return <span key={k}>{nodes}</span>;
  };

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      before.split("\n").forEach((line, i) => {
        if (i > 0) parts.push(<br key={key++} />);
        if (line) parts.push(renderInline(line, key++));
      });
    }
    parts.push(
      <pre key={key++} className="my-2 p-3 rounded-lg bg-zinc-900 text-zinc-100 text-[13px] font-mono overflow-x-auto">
        <code>{match[2].trim()}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    rest.split("\n").forEach((line, i) => {
      if (i > 0) parts.push(<br key={key++} />);
      if (line) parts.push(renderInline(line, key++));
    });
  }
  if (parts.length === 0) {
    text.split("\n").forEach((line, i) => {
      if (i > 0) parts.push(<br key={key++} />);
      if (line) parts.push(renderInline(line, key++));
    });
  }
  return <>{parts}</>;
}

// ---- CPU graph ----
function CpuGraph({ history }: { history: number[] }) {
  const max = 100;
  const w = 160;
  const h = 48;
  if (history.length < 2) return <div className="h-12 flex items-center text-xs text-zinc-400">collecting…</div>;
  const step = w / Math.max(1, history.length - 1);
  const d = history
    .map((v, i) => {
      const x = i * step;
      const y = h - (Math.min(v, max) / max) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const fillD = `${d} L ${w} ${h} L 0 ${h} Z`;
  const latest = history[history.length - 1];
  return (
    <div className="relative">
      <svg width={w} height={h} className="overflow-visible">
        <rect width={w} height={h} rx={8} className="fill-zinc-100" />
        {/* grid */}
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#e4e4e7" strokeDasharray="2 4" />
        <path d={fillD} className="fill-emerald-500/15" />
        <path d={d} fill="none" stroke="#10b981" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="absolute right-1 top-1 text-[10px] font-mono bg-white/80 rounded px-1 border">{latest.toFixed(1)}%</div>
    </div>
  );
}

// ---- main ----
export default function Home() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [liveTokPerSec, setLiveTokPerSec] = useState<number | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveStartRef = useRef<{ t: number; tokens: number } | null>(null);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);
  const messages: Message[] = active?.messages ?? [];

  // load sessions
  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
    else {
      const first: ChatSession = { id: uid(), title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      setSessions([first]);
      setActiveId(first.id);
    }
    // mobile: collapse sidebar initially on small screens
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  // persist
  useEffect(() => {
    if (sessions.length === 0) return;
    saveSessions(sessions);
  }, [sessions]);

  // auto scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTokPerSec]);

  // system stats polling (every 1s)
  useEffect(() => {
    let alive = true;
    const fetchStats = async () => {
      try {
        const r = await fetch("/api/system", { cache: "no-store" });
        if (!r.ok) return;
        const j: SystemStats = await r.json();
        if (!alive) return;
        setSystem(j);
        setCpuHistory((prev) => {
          const next = [...prev, j.cpu];
          if (next.length > 60) next.shift();
          return next;
        });
      } catch {}
    };
    fetchStats();
    const id = setInterval(fetchStats, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // live tok/s during generation (client-side estimate)
  // updated from send() as tokens stream in
  useEffect(() => {
    if (!loading) setLiveTokPerSec(null);
  }, [loading]);

  const mutateActive = useCallback(
    (fn: (m: Message[]) => Message[]) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s;
          const nextMsgs = fn(s.messages);
          return {
            ...s,
            messages: nextMsgs,
            title: nextMsgs.length === 0 ? "New chat" : titleFromMessages(nextMsgs),
            updatedAt: Date.now(),
          };
        })
      );
    },
    [activeId]
  );

  const createNewChat = () => {
    const s: ChatSession = { id: uid(), title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setError(null);
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const s: ChatSession = { id: uid(), title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        setActiveId(s.id);
        return [s];
      }
      if (activeId === id) setActiveId(filtered[0].id);
      return filtered;
    });
  };

  const deleteMessage = (idx: number) => {
    mutateActive((msgs) => msgs.filter((_, i) => i !== idx));
  };

  const clearActive = () => {
    if (loading) abortRef.current?.abort();
    mutateActive(() => []);
    setError(null);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || !activeId) return;
    setError(null);

    const userMsg: Message = { role: "user", content: trimmed };
    // add user + placeholder
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: [...s.messages, userMsg, { role: "assistant", content: "" }],
              title: s.messages.length === 0 ? titleFromMessages([userMsg]) : s.title,
              updatedAt: Date.now(),
            }
          : s
      )
    );
    setInput("");
    setLoading(true);
    liveStartRef.current = { t: performance.now(), tokens: 0 };
    setLiveTokPerSec(0);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantContent = "";
    let finalStats: MsgStats | null = null;

    try {
      const currentMessages = [...(active?.messages ?? []), userMsg];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: currentMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // stream SSE
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split SSE events: look for double newline boundaries, but also handle incremental
        // We'll parse line-by-line and also check for event: timings
        const rawEvents = buffer.split("\n\n");
        buffer = rawEvents.pop() ?? "";

        for (const raw of rawEvents) {
          const lines = raw.split("\n");
          let event = "";
          let dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          const dataStr = dataLines.join("\n");
          if (!dataStr) continue;
          if (dataStr === "[DONE]") continue;

          // Support both custom event: timings and llama.cpp's final chunk with timings field
          if (event === "timings") {
            try {
              const t = JSON.parse(dataStr);
              finalStats = {
                prompt_tokens: t.prompt_n,
                completion_tokens: t.predicted_n,
                total_tokens: (t.prompt_n ?? 0) + (t.predicted_n ?? 0),
                prompt_ms: t.prompt_ms,
                predicted_ms: t.predicted_ms,
                prompt_tps: t.prompt_per_second ?? (t.prompt_ms ? (t.prompt_n / (t.prompt_ms / 1000)) : undefined),
                predicted_tps:
                  t.predicted_per_second ??
                  (t.predicted_ms ? (t.predicted_n / (t.predicted_ms / 1000)) : undefined),
                total_ms: (t.prompt_ms ?? 0) + (t.predicted_ms ?? 0),
              };
            } catch {}
            continue;
          }

          // normal token chunk: data is JSON {choices:[{delta:{content:"..."}}]}
          // llama.cpp final chunk has: {choices:[{delta:{}}], timings:{...}} - capture timings here too
          try {
            const obj = JSON.parse(dataStr);
            if (obj.timings) {
              const t = obj.timings;
              finalStats = {
                prompt_tokens: t.prompt_n,
                completion_tokens: t.predicted_n,
                total_tokens: (t.prompt_n ?? 0) + (t.predicted_n ?? 0),
                prompt_ms: t.prompt_ms,
                predicted_ms: t.predicted_ms,
                prompt_tps: t.prompt_per_second ?? (t.prompt_ms ? (t.prompt_n / (t.prompt_ms / 1000)) : undefined),
                predicted_tps:
                  t.predicted_per_second ??
                  (t.predicted_ms ? (t.predicted_n / (t.predicted_ms / 1000)) : undefined),
                total_ms: (t.prompt_ms ?? 0) + (t.predicted_ms ?? 0),
              };
              continue;
            }
            let token = "";
            if (typeof obj.content === "string") token = obj.content;
            else if (obj.choices?.[0]?.delta?.content) token = obj.choices[0].delta.content;
            else if (typeof obj.token === "string") token = obj.token;
            else if (typeof obj.text === "string") token = obj.text;

            if (token) {
              assistantContent += token;
              // update live tok/s estimate
              const start = liveStartRef.current;
              if (start) {
                start.tokens += 1;
                const elapsed = (performance.now() - start.t) / 1000;
                if (elapsed > 0.2) setLiveTokPerSec(start.tokens / elapsed);
              }
              setSessions((prev) =>
                prev.map((s) => {
                  if (s.id !== activeId) return s;
                  const msgs = [...s.messages];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === "assistant") last.content = assistantContent;
                  return { ...s, messages: msgs, updatedAt: Date.now() };
                })
              );
            }
          } catch {
            // raw text fallback
            assistantContent += dataStr;
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== activeId) return s;
                const msgs = [...s.messages];
                msgs[msgs.length - 1].content = assistantContent;
                return { ...s, messages: msgs };
              })
            );
          }
        }
      }

      // flush remaining buffer event if any (could be timings final chunk)
      if (buffer.trim()) {
        const remaining = buffer.trim();
        // Could be "data: {...}" or "event: timings\ndata: {...}"
        const lines = remaining.split("\n");
        let event = "";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr = line.slice(5).trim();
        }
        if (dataStr && dataStr !== "[DONE]") {
          try {
            const obj = JSON.parse(dataStr);
            const t = obj.timings ?? (event === "timings" ? obj : null);
            if (t && (t.prompt_n !== undefined || t.predicted_n !== undefined)) {
              finalStats = {
                prompt_tokens: t.prompt_n,
                completion_tokens: t.predicted_n,
                total_tokens: (t.prompt_n ?? 0) + (t.predicted_n ?? 0),
                prompt_ms: t.prompt_ms,
                predicted_ms: t.predicted_ms,
                prompt_tps: t.prompt_per_second ?? (t.prompt_ms ? (t.prompt_n / (t.prompt_ms / 1000)) : undefined),
                predicted_tps:
                  t.predicted_per_second ?? (t.predicted_ms ? (t.predicted_n / (t.predicted_ms / 1000)) : undefined),
                total_ms: (t.prompt_ms ?? 0) + (t.predicted_ms ?? 0),
              };
            } else if (obj.choices?.[0]?.delta?.content) {
              assistantContent += obj.choices[0].delta.content;
            }
          } catch {}
        }
      }

      if (!assistantContent.trim()) {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== activeId) return s;
            const msgs = [...s.messages];
            if (!msgs[msgs.length - 1]?.content) msgs[msgs.length - 1].content = "(no response — try again)";
            return { ...s, messages: msgs };
          })
        );
      } else if (finalStats) {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== activeId) return s;
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") last.stats = finalStats!;
            return { ...s, messages: msgs };
          })
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("abort") || controller.signal.aborted) {
        // remove placeholder
        setSessions((prev) =>
          prev.map((s) => (s.id === activeId ? { ...s, messages: s.messages.slice(0, -1) } : s))
        );
      } else {
        setError(msg);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== activeId) return s;
            const last = s.messages[s.messages.length - 1];
            if (last?.role === "assistant" && !last.content) return { ...s, messages: s.messages.slice(0, -1) };
            return s;
          })
        );
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
      setLiveTokPerSec(null);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [sessions, search]);

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } shrink-0 bg-white border-r flex flex-col transition-all duration-200 overflow-hidden`}
        aria-hidden={!sidebarOpen}
      >
        {/* Sidebar header */}
        <div className="p-3 border-b shrink-0">
          <button
            onClick={createNewChat}
            className="w-full rounded-xl bg-zinc-900 text-white text-sm font-medium py-2.5 hover:bg-black flex items-center justify-center gap-2"
          >
            <span className="text-lg leading-none">＋</span> New chat
          </button>
          <div className="mt-3 relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full pl-7 pr-3 py-2 rounded-lg border bg-zinc-50 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-zinc-900/10"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 text-xs">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-6 px-3">No chats match “{search}”</p>
          ) : (
            filteredSessions.map((s) => (
              <div
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`group w-full text-left rounded-xl px-3 py-2.5 cursor-pointer flex items-start justify-between gap-2 border ${
                  s.id === activeId ? "bg-zinc-900 text-white border-zinc-900" : "bg-white hover:bg-zinc-50 border-zinc-200"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className={`text-sm truncate ${s.id === activeId ? "text-white" : "text-zinc-900"}`}>{s.title}</div>
                  <div className={`text-[11px] ${s.id === activeId ? "text-zinc-400" : "text-zinc-400"}`}>
                    {new Date(s.updatedAt).toLocaleDateString()} {new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${s.title}"?`)) deleteSession(s.id);
                  }}
                  title="Delete chat"
                  aria-label="Delete chat"
                  className={`shrink-0 h-7 w-7 rounded-lg flex items-center justify-center ${
                    s.id === activeId
                      ? "bg-white/10 text-zinc-300 hover:bg-red-500 hover:text-white"
                      : "bg-zinc-100 text-zinc-500 hover:bg-red-500 hover:text-white"
                  } opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Sidebar footer: system stats */}
        <div className="border-t bg-zinc-50 p-3 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">System</span>
            <span className="text-[10px] text-zinc-400">{system ? `${system.cores} cores` : "—"}</span>
          </div>
          <CpuGraph history={cpuHistory} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white border px-2 py-2">
              <div className="text-zinc-500 text-[11px]">CPU</div>
              <div className="font-mono font-semibold">{system ? `${system.cpu.toFixed(1)}%` : "—"}</div>
              <div className="text-[10px] text-zinc-400">load {system ? system.load[0]?.toFixed(2) : "—"}</div>
            </div>
            <div className="rounded-lg bg-white border px-2 py-2">
              <div className="text-zinc-500 text-[11px]">RAM</div>
              <div className="font-mono font-semibold">{system ? `${system.mem.percent.toFixed(1)}%` : "—"}</div>
              <div className="text-[10px] text-zinc-400">{system ? formatBytes(system.mem.used) : "—"}</div>
            </div>
            <div className="rounded-lg bg-white border px-2 py-2">
              <div className="text-zinc-500 text-[11px]">Temp</div>
              <div className="font-mono font-semibold">{system?.temp !== null && system?.temp !== undefined ? `${system.temp}°C` : "—"}</div>
              <div className="text-[10px] text-zinc-400">{system ? `${formatBytes(system.mem.total)} total` : ""}</div>
            </div>
            <div className="rounded-lg bg-white border px-2 py-2">
              <div className="text-zinc-500 text-[11px]">Uptime</div>
              <div className="font-mono text-[11px] font-semibold">
                {system ? `${Math.floor(system.uptime / 3600)}h ${Math.floor((system.uptime % 3600) / 60)}m` : "—"}
              </div>
              <div className="text-[10px] text-zinc-400">{loading && liveTokPerSec !== null ? `${liveTokPerSec.toFixed(1)} tok/s` : "idle"}</div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 text-center">graph updates every 1s</p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
          <div className="max-w-4xl mx-auto w-full px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="h-8 w-8 rounded-lg border bg-white flex items-center justify-center text-sm hover:bg-zinc-50 shrink-0"
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              >
                {sidebarOpen ? "‹" : "☰"}
              </button>
              <div className="h-8 w-8 rounded-lg bg-zinc-900 flex items-center justify-center text-white text-sm font-bold shrink-0">◈</div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold leading-none truncate">{active?.title ?? "Local LLM"}</h1>
                <p className="text-xs text-zinc-500 truncate">Qwen 0.5B · llama.cpp · Pi 4 · http://{typeof window !== "undefined" ? window.location.hostname : "—"}:3000</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-zinc-500">
                <span className={`h-2 w-2 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
                {loading ? (liveTokPerSec !== null ? `${liveTokPerSec.toFixed(1)} tok/s` : "generating") : "ready"}
              </span>
              <button
                onClick={clearActive}
                className="rounded-full border bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
                title="Clear messages in this chat"
              >
                Clear
              </button>
            </div>
          </div>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full px-4 py-6">
            {messages.length === 0 ? (
              <div className="py-10">
                <div className="mx-auto max-w-2xl text-center">
                  <h2 className="text-2xl font-semibold tracking-tight">How can I help you today?</h2>
                  <p className="mt-2 text-sm text-zinc-500">Private, local, and fast — running on your Raspberry Pi.</p>
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="rounded-2xl border bg-white p-4 text-sm hover:bg-zinc-50 text-left transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className={`flex gap-3 group/message ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && (
                      <div className="h-7 w-7 shrink-0 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs">✦</div>
                    )}
                    <div className={`max-w-[85%] sm:max-w-[75%] relative ${m.role === "user" ? "order-first" : ""}`}>
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                          m.role === "user"
                            ? "bg-zinc-900 text-white rounded-br-sm"
                            : "bg-white border shadow-sm rounded-bl-sm"
                        }`}
                      >
                        {m.role === "assistant" ? (
                          m.content ? (
                            <MarkdownLite text={m.content} />
                          ) : (
                            <span className="inline-flex items-center gap-1 text-zinc-500">
                              <span className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]" />
                              <span className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]" />
                              <span className="h-2 w-2 rounded-full bg-zinc-400 animate-bounce" />
                            </span>
                          )
                        ) : (
                          <span className="whitespace-pre-wrap">{m.content}</span>
                        )}
                      </div>

                      {/* per-message stats */}
                      {m.role === "assistant" && m.stats && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-mono">
                          {m.stats.prompt_tps !== undefined && (
                            <span className="rounded-full bg-white border px-2 py-0.5">prompt {m.stats.prompt_tps.toFixed(1)} tok/s</span>
                          )}
                          {m.stats.predicted_tps !== undefined && (
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5">
                              gen {m.stats.predicted_tps.toFixed(1)} tok/s
                            </span>
                          )}
                          {m.stats.prompt_tokens !== undefined && (
                            <span className="rounded-full bg-white border px-2 py-0.5">
                              {m.stats.prompt_tokens}→{m.stats.completion_tokens} tok
                            </span>
                          )}
                          {m.stats.total_ms !== undefined && (
                            <span className="rounded-full bg-white border px-2 py-0.5">{(m.stats.total_ms / 1000).toFixed(2)}s</span>
                          )}
                          {m.stats.prompt_ms !== undefined && m.stats.predicted_ms !== undefined && (
                            <span className="rounded-full bg-white border px-2 py-0.5" title="prompt / gen ms">
                              {m.stats.prompt_ms.toFixed(0)}+{m.stats.predicted_ms.toFixed(0)} ms
                            </span>
                          )}
                        </div>
                      )}

                      {/* live tok/s during streaming for the last message */}
                      {m.role === "assistant" && loading && i === messages.length - 1 && liveTokPerSec !== null && (
                        <div className="mt-1.5 text-[11px] font-mono text-amber-600">▸ streaming… ~{liveTokPerSec.toFixed(1)} tok/s</div>
                      )}

                      {/* delete per-message */}
                      <button
                        onClick={() => {
                          if (confirm("Delete this message?")) deleteMessage(i);
                        }}
                        className="absolute -top-2 -right-2 h-7 w-7 rounded-lg bg-white border shadow flex items-center justify-center opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 focus:opacity-100 hover:bg-red-500 hover:text-white hover:border-red-500 text-zinc-500 transition"
                        title="Delete message"
                        aria-label="Delete message"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                    {m.role === "user" && (
                      <div className="h-7 w-7 shrink-0 rounded-full bg-zinc-200 flex items-center justify-center text-xs">You</div>
                    )}
                  </div>
                ))}
                {error && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {error}
                    <div className="text-xs mt-1 opacity-80">
                      Make sure llama.cpp server is running: <code>~/llm/server.sh</code>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </main>

        {/* Input */}
        <footer className="sticky bottom-0 border-t bg-white">
          <div className="max-w-4xl mx-auto w-full px-4 py-3">
            <div className="flex items-end gap-2 rounded-2xl border bg-zinc-50 p-2 shadow-sm focus-within:bg-white focus-within:ring-2 focus-within:ring-zinc-900/10">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={active ? `Message ${active.title}…` : "Ask anything..."}
                rows={1}
                className="flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 max-h-32"
                style={{ height: "auto" }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 128) + "px";
                }}
              />
              {loading ? (
                <button
                  onClick={stop}
                  className="shrink-0 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  className="shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-zinc-400">
              Shift+Enter for new line · Streaming from llama.cpp · History saved locally
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
