import { NextRequest, NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") || "day";
  const qs = new URLSearchParams({ mode: mode === "swing" ? "swing" : "day" }).toString();
  const res = await stocvestAuthedFetch(`/v1/watchlists/maturation-summary?${qs}`, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
