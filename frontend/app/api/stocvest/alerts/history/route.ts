import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = u.searchParams.get("limit");
  const q = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  const res = await stocvestAuthedFetch(`/v1/alerts/history${q}`, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
