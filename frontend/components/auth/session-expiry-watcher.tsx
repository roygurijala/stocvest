"use client";

import { useEffect } from "react";
import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { markSessionExpired } from "@/lib/auth/session-expired";

/**
 * Decode JWT `exp` from the non-httpOnly mirror cookie and fire `markSessionExpired()` exactly when
 * the token expires — so the user sees the calm banner without having to wait for a 401 on their
 * next action.
 *
 * Re-evaluates on `visibilitychange` and `focus` so a user returning to a tab after sleep gets the
 * banner immediately rather than after a delayed timer.
 *
 * Does NOT redirect — the banner owns that. We only flip the bus.
 */
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

    const evaluate = () => {
      if (cancelled) return;
      const token = readWsTokenFromDocumentCookie();
      if (!token) {
        // No token visible client-side — can mean signed-out flow already fired, or the cookie
        // was scrubbed by middleware. Don't dispatch here; banner relies on explicit signals.
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        return;
      }
      const expiresAt = decodeExpiresAtMs(token);
      if (expiresAt === null) {
        markSessionExpired("expired");
        return;
      }
      const delay = expiresAt - Date.now() - SAFETY_BUFFER_MS;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (delay <= 0) {
        markSessionExpired("expired");
        return;
      }
      // Cap the timeout so an unrealistically long token doesn't stall `setTimeout` on some engines.
      const safeDelay = Math.min(delay, MAX_TIMEOUT_MS);
      timeoutId = setTimeout(() => {
        markSessionExpired("expired");
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
