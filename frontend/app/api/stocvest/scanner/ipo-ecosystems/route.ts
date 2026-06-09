import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export async function GET() {
  const res = await stocvestAuthedFetch("/v1/scanner/ipo-ecosystems", { method: "GET" });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
