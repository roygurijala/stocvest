import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_DEFAULT = "stocvest_auth_token";

function cookieName(): string {
  return process.env.STOCVEST_AUTH_COOKIE_NAME || AUTH_COOKIE_DEFAULT;
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get(cookieName())?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ops")) {
    const internal = request.headers.get("x-internal-token");
    if (!internal || internal !== process.env.INTERNAL_OPS_TOKEN) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  if (pathname.startsWith("/dashboard") && !token) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith("/login") && token) {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Include `/dashboard` so the bare path is guarded (some Next versions treat `:path*` as subpaths only).
  matcher: ["/dashboard", "/dashboard/:path*", "/login", "/ops", "/ops/:path*"]
};
