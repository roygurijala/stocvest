import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { markSessionExpired } from "@/lib/auth/session-expired";

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 55_000;

function apiBaseUrl(): string {
  const a = typeof process.env.STOCVEST_API_BASE_URL === "string" ? process.env.STOCVEST_API_BASE_URL.trim() : "";
  const b =
    typeof process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL === "string"
      ? process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL.trim()
      : "";
  return (a || b || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * JSON API fetch for Client Components (no `next/headers` / server session).
 *
 * On 401 we mark the session expired via the client event bus so the `SessionExpiredBanner`
 * renders the calm sticky bar — instead of dumping the user on the login page mid-action.
 * The banner owns the eventual redirect (with `reason=expired&next=...`) once the user
 * acknowledges by clicking "Sign in".
 */
export async function browserApiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const headers = new Headers(init?.headers || {});
  headers.set("content-type", "application/json");
  const token = readWsTokenFromDocumentCookie();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
    signal: init?.signal ?? timeoutSignal
  }).catch((error: unknown) => {
    console.error("Unable to connect. Check your connection.", error);
    return null;
  });
  if (!response) {
    return null;
  }
  if (response.status === 401) {
    markSessionExpired("auth_error");
    return null;
  }
  if (!response.ok) {
    if (response.status >= 500) {
      console.error("Service temporarily unavailable. Please try again.", {
        path,
        status: response.status
      });
      return null;
    }
    console.error("API request failed.", {
      path,
      status: response.status
    });
    return null;
  }
  return (await response.json()) as T;
}
