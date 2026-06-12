import { NextRequest, NextResponse } from "next/server";
import { isUpstreamUnavailable, stocvestAuthedReadWithRetry } from "@/lib/bff/read-route-degrade";

function deskTodayDegraded(mode: string) {
  return NextResponse.json(
    { mode, source: "cache_miss", data: null, envelope: null, degraded: true },
    { status: 200 }
  );
}

/** Proxies GET /v1/desk/today?mode=swing|day (Opportunity Desk cache). */
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") ?? "swing";
  const whySymbol = request.nextUrl.searchParams.get("why_symbol") ?? "";
  const whyParam = whySymbol.trim() ? `&why_symbol=${encodeURIComponent(whySymbol.trim())}` : "";
  try {
    const res = await stocvestAuthedReadWithRetry(
      `/v1/desk/today?mode=${encodeURIComponent(mode)}${whyParam}`,
      { method: "GET" }
    );
    if (isUpstreamUnavailable(res.status)) {
      return deskTodayDegraded(mode);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch {
    return deskTodayDegraded(mode);
  }
}
