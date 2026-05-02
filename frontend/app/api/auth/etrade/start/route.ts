import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const OAUTH_COOKIE = "stocvest_etrade_oauth";

/**
 * Starts E*TRADE OAuth: redirects the browser to E*TRADE's authorization page.
 * Stores the OAuth token secret in a short-lived HttpOnly cookie for the callback exchange.
 */
export async function GET(req: Request) {
  const { origin } = new URL(req.url);
  const callbackUrl = `${origin}/api/auth/etrade/callback`;
  const res = await stocvestAuthedFetch(
    `/v1/auth/etrade/start?${new URLSearchParams({ callback_url: callbackUrl, sandbox: "true" }).toString()}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.redirect(
      new URL(`/dashboard/settings?error=etrade_auth_failed&message=${encodeURIComponent(String((err as { message?: string }).message || "start_failed"))}`, origin)
    );
  }
  const data = (await res.json()) as {
    authorize_url?: string;
    oauth_token?: string;
    oauth_token_secret?: string;
  };
  if (!data.authorize_url || !data.oauth_token || !data.oauth_token_secret) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=etrade_auth_failed", origin));
  }
  const cookiePayload = Buffer.from(
    JSON.stringify({ oauth_token: data.oauth_token, oauth_token_secret: data.oauth_token_secret, sandbox: true }),
    "utf-8"
  ).toString("base64url");
  const redir = NextResponse.redirect(data.authorize_url);
  redir.cookies.set(OAUTH_COOKIE, cookiePayload, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production"
  });
  return redir;
}
