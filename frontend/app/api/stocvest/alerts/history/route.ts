import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const params = new URLSearchParams();
  const limit = u.searchParams.get("limit");
  if (limit) params.set("limit", limit);
  const alertType = u.searchParams.get("alert_type");
  if (alertType) params.set("alert_type", alertType);
  const symbols = u.searchParams.get("symbols");
  if (symbols) params.set("symbols", symbols);
  const q = params.toString() ? `?${params.toString()}` : "";
  const res = await stocvestAuthedFetch(`/v1/alerts/history${q}`, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
