import { cookies } from "next/headers";
import { authCookieName, parseSessionFromToken } from "@/lib/auth/session";
import { wsTokenCookieName } from "@/lib/auth/ws-token-cookie";

const cookieBase = () =>
  ({
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production"
  }) as const;

/** Sets httpOnly session cookie plus a non-httpOnly mirror so the browser can attach JWT to WebSocket query string. */
export function setSessionTokenCookiesFromIdToken(idToken: string): void {
  const session = parseSessionFromToken(idToken);
  const expires = new Date(session.expiresAtUnix * 1000);
  const base = { ...cookieBase(), expires };
  cookies().set(authCookieName(), session.token, { ...base, httpOnly: true });
  cookies().set(wsTokenCookieName(), session.token, { ...base, httpOnly: false });
}

export function clearSessionTokenCookies(): void {
  cookies().delete(authCookieName());
  cookies().delete(wsTokenCookieName());
}
