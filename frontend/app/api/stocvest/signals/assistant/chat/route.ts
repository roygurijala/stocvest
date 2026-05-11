import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * Proxy for the STOCVEST Assistant chat endpoint. The system prompt is locked on the
 * backend; this route only forwards the user's conversation turns and an optional
 * whitelisted page-context payload.
 */
export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));
  const res = await stocvestAuthedFetch("/v1/signals/assistant/chat", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
