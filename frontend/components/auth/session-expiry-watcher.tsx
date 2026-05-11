"use client";

import { useEffect } from "react";
import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { markSessionExpired } from "@/lib/auth/session-expired";
import { refreshSession } from "@/lib/auth/refresh-session";

/**
 * Sliding-session watcher.
 *
 * The browser holds a short-lived ID token (Cognito default: 60 minutes). Instead of letting
 * it expire and firing `markSessionExpired()` — which would log out an actively-working user
 * at the 60-minute mark regardless of activity — this watcher silently refreshes the token
 * shortly before it expires.
 *
 * Behavior:
 *   - On mount, on every `visibilitychange → visible`, and on every window `focus`, decode
 *     the JWT `exp` from the non-httpOnly mirror cookie.
 *   - If we're within `REFRESH_LEAD_MS` of `exp` (default 2 minutes), attempt a refresh now.
 *     If the refresh succeeds, the mirror cookie has been rewritten to a new JWT with a fresh
 *     `exp`; the next pass re-reads it and schedules from there.
 *   - Otherwise, schedule a `setTimeout` to fire the refresh at `exp - REFRESH_LEAD_MS`.
 *   - If the refresh call returns `false` (Cognito refresh failed / no refresh cookie / hard
 *     expired refresh token), fall back to `markSessionExpired("expired")` so the calm banner
 *     surfaces.
 *
 * Result: a continuously-active user with a valid Cognito refresh token (default 30-day
 * lifetime) stays signed in indefinitely — they never see the banner. A truly-inactive user
 * sees the banner only when their refresh token expires or is revoked, which is the actual
 * "expire on inactivity" contract.
 *
 * The watcher does NOT redirect on its own — `SessionExpiredBanner` owns that, and only
 * after the user clicks "Sign in".
 */
const REFRESH_LEAD_MS = 2 * 60 * 1000;
const SAFETY_BUFFER_MS = 1_500;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function decodeExpiresAtMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const seg = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = seg.length % 4;
  const normalized = pad === 0 ? seg : seg + "=".repeat(4 - pad);
  let json: string;
  try {
    json = atob(normalized);
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    /* malformed token — caller treats as expired */
  }
  return null;
}

export function SessionExpiryWatcher() {
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    /**
     * Attempt a refresh. If it succeeds, return without scheduling anything — the next
     * `evaluate()` (driven by visibility/focus or the next scheduled timer that we will
     * re-arm on the now-updated mirror cookie) will pick up the new `exp`. If it fails,
     * surface the calm banner.
     */
    const attemptRefresh = async () => {
      if (cancelled) return;
      const ok = await refreshSession();
      if (cancelled) return;
      if (!ok) {
        markSessionExpired("expired");
        return;
      }
      // Refresh succeeded; reschedule from the new `exp`.
      evaluate();
    };

    const evaluate = () => {
      if (cancelled) return;
      const token = readWsTokenFromDocumentCookie();
      if (!token) {
        // No mirror cookie visible — either logged out, or the cookie was scrubbed by the
        // refresh route after a failure. Don't dispatch here; the banner relies on explicit
        // signals (the 401 retry path in `browserApiFetch` will mark expired when the user
        // next interacts).
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        return;
      }
      const expiresAt = decodeExpiresAtMs(token);
      if (expiresAt === null) {
        // Malformed cookie — try a refresh, fall through to banner on failure.
        void attemptRefresh();
        return;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      const msUntilExp = expiresAt - Date.now();
      // Refresh `REFRESH_LEAD_MS` early so we always have a valid token in hand.
      const refreshAt = msUntilExp - REFRESH_LEAD_MS;
      if (refreshAt <= SAFETY_BUFFER_MS) {
        // We're already inside the refresh window (or past `exp`) — refresh immediately.
        void attemptRefresh();
        return;
      }
      // Cap the timeout so an unrealistically long token doesn't stall `setTimeout` on some
      // engines, and so a tab left open for days re-evaluates at least once per day.
      const safeDelay = Math.min(refreshAt, MAX_TIMEOUT_MS);
      timeoutId = setTimeout(() => {
        void attemptRefresh();
      }, safeDelay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") evaluate();
    };
    const onFocus = () => evaluate();

    evaluate();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
