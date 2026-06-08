/**
 * `POST /api/auth/refresh` — refresh the user's Cognito ID token.
 *
 * Why this exists:
 *   The browser only has the (short-lived, ~1h) ID token. Cognito's refresh token is httpOnly
 *   and never reaches JS. When the proactive `SessionExpiryWatcher` decides the ID token is
 *   close to expiry — or when an API call returns 401 mid-flight — the client POSTs here.
 *   This route reads the httpOnly refresh-token cookie, asks Cognito for a fresh ID token,
 *   rewrites the `stocvest_auth_token` + `stocvest_ws_token` cookies, and returns the new
 *   `exp` so the watcher can reschedule. On any failure we clear all three session cookies
 *   and return 401 so the client falls back to the calm "Sign in" banner.
 *
 * Contract:
 *   - 200 `{ exp: <unix-seconds> }` — refresh succeeded; the new ID token is already in the
 *     response's `Set-Cookie` headers, so the very next request from the browser carries it.
 *   - 401 `{ error: "refresh_failed" | "no_refresh_token" }` — caller should treat as fully
 *     signed out (cookies have been cleared on this side already).
 *
 * Security:
 *   - Same-origin only. The route reads cookies (`SameSite=Lax`) which modern browsers do not
 *     attach on cross-site `POST` navigations, so CSRF is not a meaningful concern.
 *   - No request body is read or trusted; everything comes from cookies.
 *   - The httpOnly refresh-token cookie never leaves this handler.
 */

import { NextResponse } from "next/server";
import { refreshIdToken } from "@/lib/auth/cognito";
import { readRefreshTokenCookie } from "@/lib/auth/refresh-token-cookie";
import { parseSessionFromToken } from "@/lib/auth/session";
import { clearSessionTokenCookies, setSessionTokenCookiesFromIdToken } from "@/lib/auth/session-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const refreshToken = readRefreshTokenCookie();
  if (!refreshToken) {
    // No refresh cookie at all — either the user signed in before refresh support shipped, or
    // the dev-mock login path was used, or the cookie has already been cleared. Either way,
    // the session is unrecoverable.
    //
    // Clear the ID + mirror cookies too (honoring this route's "clear on any failure" contract).
    // Without this, a token whose `exp` is still in the future but which the API Gateway rejects
    // (e.g. a dev-mock unsigned token pointed at the deployed authorizer) lingers in the cookie
    // jar: the client marks the session expired, but the middleware/login gate still sees a
    // "valid" (un-expired) cookie and bounces the user back to /dashboard — an infinite loop.
    // Scrubbing the cookies here makes the failure a clean logout so re-login sticks.
    clearSessionTokenCookies();
    return NextResponse.json({ error: "no_refresh_token" }, { status: 401 });
  }

  try {
    const { idToken } = await refreshIdToken(refreshToken);
    if (!idToken) {
      // Cognito returned 200 but no AuthenticationResult — defensive: treat as failure and
      // clear cookies so the browser stops sending stale credentials.
      clearSessionTokenCookies();
      return NextResponse.json({ error: "refresh_failed" }, { status: 401 });
    }
    // Rewrite ID + mirror cookies with the new token. Don't pass `refreshToken` — Cognito
    // does NOT issue a new refresh token on `REFRESH_TOKEN_AUTH` (no rotation in our pool
    // config); the existing httpOnly cookie stays valid until its own 30-day expiry.
    setSessionTokenCookiesFromIdToken(idToken);
    const session = parseSessionFromToken(idToken);
    return NextResponse.json({ exp: session.expiresAtUnix }, { status: 200 });
  } catch {
    // Any Cognito failure (token revoked, refresh expired, network blip on the AWS SDK call)
    // — clear cookies and signal hard-expired. The client will surface the calm banner.
    clearSessionTokenCookies();
    return NextResponse.json({ error: "refresh_failed" }, { status: 401 });
  }
}
