import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function POST(req: Request) {
  const key = process.env.STOCVEST_INTERNAL_ANALYSIS_KEY?.trim();
  const headers: Record<string, string> = {};
  if (key) {
    headers["x-stocvest-internal-analysis"] = key;
  }
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch("/v1/portfolio/positions/close", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
