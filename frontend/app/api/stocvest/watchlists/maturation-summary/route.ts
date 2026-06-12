import { NextRequest, NextResponse } from "next/server";
import { isUpstreamUnavailable, stocvestAuthedReadWithRetry } from "@/lib/bff/read-route-degrade";

export async function GET(req: NextRequest) {
  const modeParam = req.nextUrl.searchParams.get("mode") || "day";
  const mode = modeParam === "swing" ? "swing" : "day";
  const qs = new URLSearchParams({ mode }).toString();
  try {
    const res = await stocvestAuthedReadWithRetry(`/v1/watchlists/maturation-summary?${qs}`, { method: "GET" });
    if (isUpstreamUnavailable(res.status)) {
      return NextResponse.json(
        { mode, by_symbol: {}, degraded: true, upstream_status: res.status },
        { status: 200 }
      );
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ mode, by_symbol: {}, degraded: true }, { status: 200 });
  }
}
