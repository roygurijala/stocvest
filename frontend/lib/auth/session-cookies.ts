import { cookies } from "next/headers";
import { authCookieName, parseSessionFromToken } from "@/lib/auth/session";
import { refreshTokenCookieName } from "@/lib/auth/refresh-token-cookie";
import { wsTokenCookieName } from "@/lib/auth/ws-token-cookie";

const cookieBase = () =>
  ({
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production"
  }) as const;

/**
 * Refresh-token cookie lifetime. Cognito's default `refresh_token_validity` on the user pool
 * client is 30 days; we mirror that on the cookie so the browser drops the cookie at the same
 * moment Cognito would reject it. Changing this constant **does not** extend the underlying
 * Cognito refresh-token validity — that has to be done in `infra/cognito.tf`.
 */
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Write the three session cookies that the BFF + browser need to keep a user signed in:
 *
 *   - `stocvest_auth_token`   (httpOnly) — what every server-side handler reads via
 *     `getServerSession()` and what the BFF forwards as the `Authorization: Bearer` to the API
 *     Gateway.
 *   - `stocvest_ws_token`     (NOT httpOnly) — mirror so the browser can attach the JWT to the
 *     WebSocket URL and so `SessionExpiryWatcher` can decode `exp` and schedule a proactive
 *     refresh.
 *   - `stocvest_refresh_token` (httpOnly) — opaque Cognito refresh token. Only ever read inside
 *     `POST /api/auth/refresh`; the browser cannot see it.
 *
 * `refreshToken` is optional because two write paths intentionally don't have one:
 *   - The dev-mock login (`loginAsDevUser`) mints a long-lived unsigned JWT and skips Cognito
 *     entirely; refresh isn't applicable, the dev token already has `exp = now + 365d`.
 *   - The `POST /api/auth/refresh` route rewrites only the ID + mirror cookies (Cognito reuses
 *     the same refresh token across refreshes, so we leave that cookie untouched).
 */
export function setSessionTokenCookiesFromIdToken(idToken: string, refreshToken?: string): void {
  const session = parseSessionFromToken(idToken);
  const expires = new Date(session.expiresAtUnix * 1000);
  const base = { ...cookieBase(), expires };
  cookies().set(authCookieName(), session.token, { ...base, httpOnly: true });
  cookies().set(wsTokenCookieName(), session.token, { ...base, httpOnly: false });
  if (refreshToken) {
    cookies().set(refreshTokenCookieName(), refreshToken, {
      ...cookieBase(),
      httpOnly: true,
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
    });
  }
}

export function clearSessionTokenCookies(): void {
  cookies().delete(authCookieName());
  cookies().delete(wsTokenCookieName());
  cookies().delete(refreshTokenCookieName());
}
