import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch("/v1/orders/validate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
