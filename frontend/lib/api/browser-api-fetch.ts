import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";
import { markSessionExpired } from "@/lib/auth/session-expired";
import { refreshSession } from "@/lib/auth/refresh-session";

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 55_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_TRANSIENT_ATTEMPTS = 3;
const RETRY_BASE_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiBaseUrl(): string {
  const a = typeof process.env.STOCVEST_API_BASE_URL === "string" ? process.env.STOCVEST_API_BASE_URL.trim() : "";
  const b =
    typeof process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL === "string"
      ? process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL.trim()
      : "";
  return (a || b || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || {});
  headers.set("content-type", "application/json");
  const token = readWsTokenFromDocumentCookie();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

/**
 * JSON API fetch for Client Components (no `next/headers` / server session).
 *
 * Sliding-session contract:
 *   - On 401, we attempt a silent refresh via `refreshSession()` (which coalesces parallel
 *     callers onto a single in-flight POST to `/api/auth/refresh`). If the refresh succeeds,
 *     we retry the original request **once** with the freshly-rewritten `stocvest_ws_token`
 *     cookie. The user never sees the calm banner for that path.
 *   - Only if the refresh itself fails — or the retry also returns 401 — do we fire
 *     `markSessionExpired("auth_error")` so `SessionExpiredBanner` renders.
 *   - 403 is intentionally NOT treated as auth failure: STOCVEST uses 403 for product-rule
 *     denials (PDT lockout, margin, paid-tier gating) where the user IS authenticated.
 *   - 502/503/504 are retried up to 3 times with linear backoff before surfacing an error.
 */
export async function browserApiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const url = `${apiBaseUrl()}${path}`;

  const doFetch = async (): Promise<Response | null> => {
    let pending: ReturnType<typeof fetch>;
    try {
      pending = fetch(url, {
        ...init,
        headers: buildHeaders(init),
        credentials: "include",
        cache: "no-store",
        signal: init?.signal ?? timeoutSignal
      });
    } catch (error: unknown) {
      console.error("Unable to connect. Check your connection.", error);
      return null;
    }
    if (!pending || typeof pending.then !== "function") {
      console.error("Unable to connect. Check your connection.");
      return null;
    }
    return pending.catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        return null;
      }
      console.error("Unable to connect. Check your connection.", error);
      return null;
    });
  };

  let response = await doFetch();
  if (!response) return null;

  for (let attempt = 0; attempt < MAX_TRANSIENT_ATTEMPTS; attempt++) {
    if (!response) return null;

    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        response = await doFetch();
        if (!response) return null;
        if (response.status === 401) {
          markSessionExpired("auth_error");
          return null;
        }
      } else {
        markSessionExpired("auth_error");
        return null;
      }
    }

    if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt === MAX_TRANSIENT_ATTEMPTS - 1) {
      break;
    }
    await sleep(RETRY_BASE_MS * (attempt + 1));
    response = await doFetch();
  }

  if (!response) return null;

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
