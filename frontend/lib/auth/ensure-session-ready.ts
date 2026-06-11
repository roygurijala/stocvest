import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { refreshSession } from "@/lib/auth/refresh-session";

/** Match `SessionExpiryWatcher` — refresh when inside this window of JWT `exp`. */
const REFRESH_LEAD_MS = 2 * 60 * 1000;

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
    /* malformed */
  }
  return null;
}

/**
 * Await a valid session before firing a burst of client API calls (e.g. trading-room mount refresh).
 *
 * After long idle, the ID token may be at or past `exp` even though the httpOnly refresh cookie is
 * still valid. `SessionExpiryWatcher` refreshes in parallel with mount effects; this helper lets
 * background refresh paths wait for that refresh (or run one) first so the first API wave does not
 * hit the backend with an expired bearer token.
 */
export async function ensureSessionReady(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const token = readWsTokenFromDocumentCookie();
  if (!token) return false;
  const expiresAt = decodeExpiresAtMs(token);
  if (expiresAt === null) {
    return refreshSession();
  }
  if (expiresAt - Date.now() <= REFRESH_LEAD_MS) {
    return refreshSession();
  }
  return true;
}
