/**
 * Build a `/login` URL that explains why the user landed there and where to send them after sign-in.
 *
 * Used everywhere we redirect to the login page — middleware (`middleware.ts`), server `apiFetch`,
 * client `browserApiFetch`, the `SessionExpiredBanner`, and per-page `redirect()` calls — so the
 * URL contract stays in one place.
 *
 * `next` is sanitized: only same-origin, absolute paths starting with a single `/` are allowed.
 * Anything else is dropped silently to prevent open redirect attempts.
 */

const ALLOWED_REASONS = new Set(["expired", "signed_out"] as const);

export type LoginRedirectReason = "expired" | "signed_out";

/** Whitelist of internal paths that may follow `?next=`. Returns the path or `null` if rejected. */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject protocol-relative ("//evil.com/...") and full URLs.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  // Disallow control characters / whitespace inside the path.
  if (/[\x00-\x1f\s]/.test(trimmed)) return null;
  return trimmed;
}

export function loginRedirectPath(
  reason?: LoginRedirectReason,
  nextPath?: string | null
): string {
  const params = new URLSearchParams();
  if (reason && ALLOWED_REASONS.has(reason)) {
    params.set("reason", reason);
  }
  const safeNext = sanitizeNextPath(nextPath);
  if (safeNext) {
    params.set("next", safeNext);
  }
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}

/** Pretty copy for the login page to render — keeps wording in one file. */
export function loginReasonMessage(reason: string | null | undefined): string | null {
  if (reason === "expired") {
    return "Your session has expired. Please sign in again to continue.";
  }
  return null;
}

/** Optional secondary line shown under the primary reason message. */
export function loginReasonSecondary(reason: string | null | undefined): string | null {
  if (reason === "expired") {
    return "For security, we sign out inactive sessions.";
  }
  return null;
}
