import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Proxies POST /v1/desk/refresh (Opportunity Desk manual batch — scanner Lambda). */
export const maxDuration = 120;

export async function POST() {
  try {
    const res = await stocvestAuthedFetch("/v1/desk/refresh", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json(
      { status: "error", message: "Refresh request failed" },
      { status: 502 }
    );
  }
}
