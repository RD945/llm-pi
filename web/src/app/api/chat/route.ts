export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LLAMA_URL = process.env.LLAMA_URL || "http://127.0.0.1:8080";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("messages required", { status: 400 });
    }
    const SYSTEM_EN = "You are a helpful assistant. Always respond in English.";
    const withSystem =
      messages[0]?.role === "system" ? messages : [{ role: "system", content: SYSTEM_EN }, ...messages];

    const llamaRes = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: withSystem,
        stream: true,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048,
      }),
    });

    if (!llamaRes.ok) {
      const err = await llamaRes.text();
      return new Response(`llama.cpp error ${llamaRes.status}: ${err}`, { status: 502 });
    }
    if (!llamaRes.body) return new Response("No body from llama.cpp", { status: 502 });

    // Simple proxy - forward raw SSE stream directly (most reliable)
    // Frontend will parse timings from the final SSE chunk
    const headers = new Headers();
    headers.set("Content-Type", "text/event-stream");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");
    return new Response(llamaRes.body, { headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("Failed to fetch")) {
      return new Response(`Cannot reach llama.cpp at ${LLAMA_URL}. Is it running? Start with: ~/llm/server.sh`, { status: 502 });
    }
    return new Response(msg, { status: 500 });
  }
}

export async function GET() {
  try {
    const r = await fetch(`${LLAMA_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const text = await r.text();
    return new Response(JSON.stringify({ llama_url: LLAMA_URL, status: r.ok ? "ok" : "error", body: text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ llama_url: LLAMA_URL, status: "down", error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
