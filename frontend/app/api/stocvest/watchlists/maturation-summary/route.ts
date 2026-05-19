import { NextRequest, NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: NextRequest) {
  const modeParam = req.nextUrl.searchParams.get("mode") || "day";
  const mode = modeParam === "swing" ? "swing" : "day";
  const qs = new URLSearchParams({ mode }).toString();
  try {
    const res = await stocvestAuthedFetch(`/v1/watchlists/maturation-summary?${qs}`, { method: "GET" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 500) {
      return NextResponse.json(
        { mode, by_symbol: {}, degraded: true, upstream_status: res.status },
        { status: 200 }
      );
    }
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ mode, by_symbol: {}, degraded: true }, { status: 200 });
  }
}
