import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET() {
  const res = await stocvestAuthedFetch("/v1/holdings/pending-splits", { method: "GET" });
  const body = await res.json().catch(() => ({ pendingSplits: [], count: 0 }));
  return NextResponse.json(body, { status: res.status });
}
