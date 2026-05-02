import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

const OAUTH_COOKIE = "stocvest_etrade_oauth";

/**
 * OAuth 1.0a callback from E*TRADE (GET with oauth_token + oauth_verifier).
 * Exchanges the verifier for access tokens via the STOCVEST API.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const oauthToken = url.searchParams.get("oauth_token") || "";
  const oauthVerifier = url.searchParams.get("oauth_verifier") || "";

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=etrade_auth_failed", origin));
  }

  const raw = cookies().get(OAUTH_COOKIE)?.value;
  if (!raw) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=etrade_auth_failed", origin));
  }
  let tokenSecret = "";
  let sandbox = true;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as {
      oauth_token?: string;
      oauth_token_secret?: string;
      sandbox?: boolean;
    };
    if (parsed.oauth_token !== oauthToken) {
      return NextResponse.redirect(new URL("/dashboard/settings?error=etrade_auth_failed", origin));
    }
    tokenSecret = parsed.oauth_token_secret || "";
    sandbox = parsed.sandbox !== false;
  } catch {
    return NextResponse.redirect(new URL("/dashboard/settings?error=etrade_auth_failed", origin));
  }

  const res = await stocvestAuthedFetch("/v1/auth/etrade/callback", {
    method: "POST",
    body: JSON.stringify({
      oauth_token: oauthToken,
      oauth_token_secret: tokenSecret,
      oauth_verifier: oauthVerifier,
      sandbox
    })
  });

  const done = NextResponse.redirect(
    res.ok
      ? new URL("/dashboard/settings?connected=etrade", origin)
      : new URL("/dashboard/settings?error=etrade_auth_failed", origin)
  );
  done.cookies.delete(OAUTH_COOKIE);
  return done;
}
