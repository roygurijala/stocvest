/**
 * Refresh-token cookie helpers.
 *
 * The refresh token is **httpOnly** — it never crosses the JS/network boundary except inside the
 * BFF (`POST /api/auth/refresh`). The browser cannot read it, the API Gateway never sees it,
 * and the Anthropic / WebSocket paths never touch it. This is critical: a leaked ID token gives
 * an attacker ~1h; a leaked refresh token gives 30 days, so we keep it locked to same-origin
 * server-side reads only.
 *
 * Companion of:
 *   - `session-cookies.ts` — writes / clears all three cookies in lockstep (auth + ws-mirror +
 *     this one).
 *   - `app/api/auth/refresh/route.ts` — the only place that reads this cookie.
 */

import "server-only";
import { cookies } from "next/headers";

const DEFAULT_REFRESH_COOKIE_NAME = "stocvest_refresh_token";

/** Cookie name used to store the Cognito refresh token (httpOnly). */
export function refreshTokenCookieName(): string {
  return process.env.STOCVEST_REFRESH_COOKIE_NAME || DEFAULT_REFRESH_COOKIE_NAME;
}

/**
 * Read the refresh token from the request cookies. Returns null if the cookie is missing or
 * empty — callers use that as the "no refresh available, treat as fully signed out" signal.
 */
export function readRefreshTokenCookie(): string | null {
  const value = cookies().get(refreshTokenCookieName())?.value;
  return value && value.length > 0 ? value : null;
}
