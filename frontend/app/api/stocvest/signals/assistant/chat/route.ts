import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/**
 * Proxy for the STOCVEST Assistant chat endpoint. The system prompt is locked on the
 * backend; this route only forwards the user's conversation turns, an optional
 * whitelisted page-context payload, and an optional base64-encoded image attachment.
 *
 * Size guard: reject bodies where the attached_image.data field exceeds ~6 MB base64
 * (≈ 4.5 MB raw image) to prevent Lambda payload limit errors before the request
 * reaches the backend.
 */

const MAX_IMAGE_BASE64_CHARS = 6_400_000; // ~4.8 MB raw

export async function POST(req: Request) {
  const payload = await req.json().catch(() => ({}));

  // Guard: if an image is attached, verify it isn't oversized.
  if (
    payload &&
    typeof payload === "object" &&
    payload.attached_image &&
    typeof payload.attached_image.data === "string" &&
    payload.attached_image.data.length > MAX_IMAGE_BASE64_CHARS
  ) {
    return NextResponse.json(
      { error: "attached_image too large", message: "Image must be under 5 MB." },
      { status: 413 }
    );
  }

  const res = await stocvestAuthedFetch("/v1/signals/assistant/chat", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
