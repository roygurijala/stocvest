import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function POST(req: Request, { params }: { params: { symbol: string } }) {
  const symbol = encodeURIComponent((params.symbol || "").trim());
  const body = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch(`/v1/holdings/${symbol}/split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const out = await res.json().catch(() => ({}));
  return NextResponse.json(out, { status: res.status });
}
