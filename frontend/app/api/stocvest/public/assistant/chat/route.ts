import { NextResponse } from "next/server";
import { apiBaseUrl } from "@/lib/api/client";

/**
 * BFF proxy for the **unauthenticated** STOCVEST Assistant chat used on the marketing
 * surface (`/`, `/signup`, `/login`, etc.). The backend route has no JWT authorizer and
 * the locked system prompt's PUBLIC MODE section is activated server-side, so this
 * handler simply forwards the visitor's conversation turns. The client never speaks to
 * the API origin directly — keeping the API base URL server-only.
 *
 * Only whitelisted `marketing/*` page_context is forwarded; symbol/decision fields are
 * stripped on the backend.
 */
export async function POST(req: Request) {
  const payload = (await req.json().catch(() => ({}))) as {
    messages?: unknown;
    page_context?: unknown;
  };
  const pageContext =
    payload?.page_context && typeof payload.page_context === "object" && !Array.isArray(payload.page_context)
      ? (payload.page_context as Record<string, unknown>)
      : null;
  const safeBody = {
    messages: Array.isArray(payload?.messages) ? payload.messages : [],
    page_context: pageContext
  };
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/v1/public/assistant/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(safeBody),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      { error: "upstream_unreachable", text: "" },
      { status: 502 }
    );
  }
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
