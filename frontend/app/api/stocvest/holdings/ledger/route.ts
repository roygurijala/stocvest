import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET() {
  const res = await stocvestAuthedFetch("/v1/holdings/ledger", { method: "GET" });
  const body = await res.json().catch(() => ({ events: [], count: 0 }));
  return NextResponse.json(body, { status: res.status });
}
