export const dynamic = "force-dynamic";

import { readFile } from "fs/promises";
import * as os from "os";

// Keep last CPU snapshot in memory for delta calculation
let lastCpu: { idle: number; total: number } | null = null;

async function readCpuUsage(): Promise<number> {
  try {
    const data = await readFile("/proc/stat", "utf-8");
    const line = data.split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return 0;
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    // fields: user nice system idle iowait irq softirq steal guest guest_nice
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
    const total = parts.reduce((a, b) => a + b, 0);
    let usage = 0;
    if (lastCpu) {
      const idleDiff = idle - lastCpu.idle;
      const totalDiff = total - lastCpu.total;
      if (totalDiff > 0) usage = (1 - idleDiff / totalDiff) * 100;
    }
    lastCpu = { idle, total };
    return Math.max(0, Math.min(100, usage));
  } catch {
    // fallback to os.cpus()
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (const c of cpus) {
      for (const type in c.times) totalTick += (c.times as Record<string, number>)[type];
      totalIdle += c.times.idle;
    }
    return 0;
  }
}

async function readMem() {
  try {
    const data = await readFile("/proc/meminfo", "utf-8");
    const get = (k: string) => {
      const m = data.match(new RegExp(`${k}:\\s+(\\d+)`));
      return m ? parseInt(m[1]) * 1024 : 0;
    };
    const total = get("MemTotal");
    const avail = get("MemAvailable");
    const used = total - avail;
    return { total, used, available: avail, percent: total ? (used / total) * 100 : 0 };
  } catch {
    return { total: os.totalmem(), used: os.totalmem() - os.freemem(), available: os.freemem(), percent: 0 };
  }
}

async function readTemp(): Promise<number | null> {
  const candidates = [
    "/sys/class/thermal/thermal_zone0/temp",
    "/sys/class/thermal/thermal_zone1/temp",
  ];
  for (const p of candidates) {
    try {
      const v = await readFile(p, "utf-8");
      const n = parseInt(v.trim());
      // usually millidegree
      if (n > 1000) return n / 1000;
      if (n > 0) return n;
    } catch {}
  }
  return null;
}

export async function GET() {
  const [cpu, mem, temp] = await Promise.all([readCpuUsage(), readMem(), readTemp()]);
  const load = os.loadavg(); // [1min,5min,15min]
  const uptime = os.uptime();

  return new Response(
    JSON.stringify({
      cpu: Math.round(cpu * 10) / 10,
      mem: {
        total: mem.total,
        used: mem.used,
        percent: Math.round(mem.percent * 10) / 10,
      },
      temp: temp !== null ? Math.round(temp * 10) / 10 : null,
      load: load.map((v) => Math.round(v * 100) / 100),
      cores: os.cpus().length,
      uptime,
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } }
  );
}
