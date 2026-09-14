import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Cold 25-name compose can approach the HTTP API 29s cap; keep the BFF alive to degrade. */
export const maxDuration = 60;

const DEGRADED = {
  mode: "position",
  candidates: [],
  count: 0,
  universe_size: 0,
  scan_generated_at: null,
  cached: false,
  degraded: true,
  pending: false
};

/** Proxies GET /v1/signals/position/candidates for Client Components (ADR-004 POS-D15). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const qs = u.searchParams.toString();
  const upstream = qs
    ? `/v1/signals/position/candidates?${qs}`
    : "/v1/signals/position/candidates";
  try {
    const res = await stocvestAuthedFetch(upstream, { method: "GET" });
    if (res.status === 401 || res.status === 403) {
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") || "application/json" }
      });
    }
    // Missing API Gateway route is a native 404 (not Lambda 401). Treat it — and
    // 5xx / timeout envelopes — as a degraded empty scan so the client can retry
    // instead of throwing a hard fetch error.
    if (!res.ok) {
      return NextResponse.json(DEGRADED, { status: 200 });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json(DEGRADED, { status: 200 });
  }
}
