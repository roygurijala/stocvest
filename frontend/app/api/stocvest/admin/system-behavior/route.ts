import { NextRequest, NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") || "swing";
  const days = req.nextUrl.searchParams.get("days") || "30";
  const qs = new URLSearchParams({
    mode: mode === "day" ? "day" : "swing",
    days
  }).toString();
  const res = await stocvestAuthedFetch(`/v1/admin/system-behavior?${qs}`, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
