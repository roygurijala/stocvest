/** Non-layer composite envelopes returned when compute/cache/rate-limit fails. */

export type CompositeTransportErrorCode =
  | "timeout"
  | "upstream_unavailable"
  | "rate_limited";

export type CompositeTransportError = {
  code: CompositeTransportErrorCode;
  message: string;
  retryAfterSec?: number;
};

const DEFAULT_MESSAGES: Record<CompositeTransportErrorCode, string> = {
  timeout: "Signal analysis timed out. Try again in a moment.",
  upstream_unavailable: "Market data is briefly unavailable. Try again in a moment.",
  rate_limited: "Too many requests. Wait a moment and try again."
};

function isTransportCode(raw: string): raw is CompositeTransportErrorCode {
  return raw === "timeout" || raw === "upstream_unavailable" || raw === "rate_limited";
}

export function getCompositeTransportError(
  body: Record<string, unknown> | null | undefined
): CompositeTransportError | null {
  if (!body || typeof body !== "object") return null;
  const raw = String(body.error ?? "").trim();
  if (!isTransportCode(raw)) return null;
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : DEFAULT_MESSAGES[raw];
  const retryAfter =
    typeof body.retry_after === "number" && Number.isFinite(body.retry_after)
      ? Math.max(1, Math.round(body.retry_after))
      : undefined;
  return { code: raw, message, retryAfterSec: retryAfter };
}

export function compositeFetchErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const m = error.message.match(/\bfailed:\s*(\d{3})\b/i);
  const status = m ? Number(m[1]) : NaN;
  if (status === 503 || status === 502 || status === 504) {
    return "The signal service is temporarily unavailable. Try again in a moment.";
  }
  if (status === 429) {
    return "Too many requests. Wait a moment and try again.";
  }
  return null;
}
