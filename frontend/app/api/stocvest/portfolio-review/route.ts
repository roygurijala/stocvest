import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

// Each GET is a cache/pending poll (milliseconds) or a refresh kick. The heavy
// composite runs in a background Lambda invoke, but keep headroom for a cold start.
export const maxDuration = 60;

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh");
  const qs = refresh ? `?refresh=${encodeURIComponent(refresh)}` : "";
  const res = await stocvestAuthedFetch(`/v1/portfolio-review${qs}`, { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
