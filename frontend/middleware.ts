import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_DEFAULT = "stocvest_auth_token";
const WS_TOKEN_COOKIE_DEFAULT = "stocvest_ws_token";
/** Header read by server-side helpers (e.g. `apiFetch`) to build `?next=...` for login redirects. */
const PATHNAME_HEADER = "x-stocvest-pathname";

function authCookieName(): string {
  return process.env.STOCVEST_AUTH_COOKIE_NAME || AUTH_COOKIE_DEFAULT;
}

function wsTokenCookieName(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_WS_TOKEN_COOKIE_NAME || WS_TOKEN_COOKIE_DEFAULT;
}

/**
 * Decode the JWT `exp` claim using only WebCrypto-safe primitives (Edge runtime — no Node `Buffer`).
 * Returns `null` if the token is malformed or has no numeric `exp`.
 */
function jwtExpiresAt(token: string): number | null {
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
      return payload.exp;
    }
    return null;
  } catch {
    return null;
  }
}

function isExpiredOrInvalid(token: string | undefined): boolean {
  if (!token) return true;
  const exp = jwtExpiresAt(token);
  if (exp === null) return true;
  return Date.now() / 1000 >= exp;
}

/** Build a `/login` redirect URL with `reason=expired` and a sanitized `next=` query. */
function buildExpiredLoginUrl(request: NextRequest): URL {
  const url = new URL("/login", request.url);
  url.searchParams.set("reason", "expired");
  const path = request.nextUrl.pathname;
  if (path && path.startsWith("/") && !path.startsWith("//")) {
    const search = request.nextUrl.search ?? "";
    url.searchParams.set("next", `${path}${search}`);
  }
  return url;
}

function clearAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete(authCookieName());
  response.cookies.delete(wsTokenCookieName());
  return response;
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get(authCookieName())?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ops")) {
    const internal = request.headers.get("x-internal-token");
    if (!internal || internal !== process.env.INTERNAL_OPS_TOKEN) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  // `/dashboard` is the protected surface — validate the JWT `exp` (not just cookie presence) so
  // a stale cookie can't bypass auth and so we land users on the calm "session expired" copy.
  if (pathname.startsWith("/dashboard")) {
    if (isExpiredOrInvalid(token)) {
      const loginUrl = buildExpiredLoginUrl(request);
      const reason = token ? "expired" : undefined;
      // Drop the reason flag when there was never a session (e.g. cold first visit).
      if (!reason) loginUrl.searchParams.delete("reason");
      return clearAuthCookies(NextResponse.redirect(loginUrl));
    }
  }

  // `/login` while signed in → bounce to dashboard, but only if the cookie is actually valid.
  // An expired cookie should let the user reach `/login` so they can sign in again.
  if (pathname.startsWith("/login") && token && !isExpiredOrInvalid(token)) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  // Forward the current path to RSC / route handlers via a request header. `apiFetch` reads this
  // to build `?next=` when its 401 path triggers a server-side redirect to login.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${request.nextUrl.search ?? ""}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Include `/dashboard` so the bare path is guarded (some Next versions treat `:path*` as subpaths only).
  matcher: ["/dashboard", "/dashboard/:path*", "/login", "/ops", "/ops/:path*"]
};
