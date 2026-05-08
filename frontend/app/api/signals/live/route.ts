import { Redis } from "@upstash/redis";

export const runtime = "edge";

/** Polled hint key — Upstash REST has no long-lived subscribe on Edge. */
const LIVE_HINT_KEY = "stocvest:signals:live_hint";

function redisOrNull(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function withinUsEquityRthEt(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") ?? "swing";

  if (mode === "swing") {
    return new Response(null, { status: 204 });
  }

  if (!withinUsEquityRthEt(new Date())) {
    return new Response(null, { status: 204 });
  }

  const redis = redisOrNull();
  if (!redis) {
    return new Response(null, { status: 204 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let lastHint: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        while (!closed) {
          await new Promise((r) => setTimeout(r, 3000));
          if (closed) break;
          try {
            const v = await redis.get(LIVE_HINT_KEY);
            const msg = typeof v === "string" ? v : v != null ? String(v) : null;
            if (msg && msg !== lastHint) {
              lastHint = msg;
              const hint = {
                type: "signal_update",
                state_version: msg,
                hint_at: new Date().toISOString()
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(hint)}\n\n`));
            }
          } catch {
            /* ignore transient read errors */
          }
        }
      } catch {
        if (!closed) controller.close();
      }
    },
    cancel() {
      closed = true;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
