import { NextResponse } from "next/server";
import { isUpstreamUnavailable, stocvestAuthedReadWithRetry } from "@/lib/bff/read-route-degrade";

/** Proxies GET /v1/market/vix-snapshot (Lambda Polygon + indices fallback) with retry + degrade. */
export async function GET() {
  try {
    const res = await stocvestAuthedReadWithRetry("/v1/market/vix-snapshot", { method: "GET" });
    if (isUpstreamUnavailable(res.status)) {
      return NextResponse.json({ snapshot: null, degraded: true }, { status: 200 });
    }
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" }
    });
  } catch {
    return NextResponse.json({ snapshot: null, degraded: true }, { status: 200 });
  }
}
