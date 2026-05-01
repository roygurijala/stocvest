const DEFAULT_WS_TOKEN_COOKIE_NAME = "stocvest_ws_token";

/** Same name server uses when setting the non-httpOnly mirror cookie (NEXT_PUBLIC so client and server agree). */
export function wsTokenCookieName(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_WS_TOKEN_COOKIE_NAME || DEFAULT_WS_TOKEN_COOKIE_NAME;
}

/** Read IdToken mirror from `document.cookie` for WebSocket URL (httpOnly session cookie is not readable in JS). */
export function readWsTokenFromDocumentCookie(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const name = wsTokenCookieName();
  const prefix = `${name}=`;
  const segment = document.cookie.split("; ").find((row) => row.startsWith(prefix));
  if (!segment) {
    return null;
  }
  const raw = segment.slice(prefix.length);
  if (!raw) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
