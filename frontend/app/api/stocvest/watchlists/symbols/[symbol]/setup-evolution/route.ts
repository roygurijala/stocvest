import { NextRequest, NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

type RouteContext = { params: Promise<{ symbol: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { symbol } = await context.params;
  const mode = req.nextUrl.searchParams.get("mode") || "swing";
  const qs = new URLSearchParams({ mode: mode === "day" ? "day" : "swing" }).toString();
  const res = await stocvestAuthedFetch(
    `/v1/watchlists/symbols/${encodeURIComponent(symbol)}/setup-evolution?${qs}`,
    { method: "GET" }
  );
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
