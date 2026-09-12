import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function DELETE(_req: Request, { params }: { params: { symbol: string } }) {
  const symbol = encodeURIComponent((params.symbol || "").trim());
  const res = await stocvestAuthedFetch(`/v1/holdings/${symbol}`, { method: "DELETE" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
