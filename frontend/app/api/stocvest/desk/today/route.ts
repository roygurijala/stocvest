import { NextRequest, NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies GET /v1/desk/today?mode=swing|day (Opportunity Desk cache). */
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") ?? "swing";
  const whySymbol = request.nextUrl.searchParams.get("why_symbol") ?? "";
  const whyParam = whySymbol.trim() ? `&why_symbol=${encodeURIComponent(whySymbol.trim())}` : "";
  try {
    const res = await stocvestAuthedFetch(
      `/v1/desk/today?mode=${encodeURIComponent(mode)}${whyParam}`,
      { method: "GET" }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json(
      { mode, source: "cache_miss", data: null, envelope: null },
      { status: 200 }
    );
  }
}
