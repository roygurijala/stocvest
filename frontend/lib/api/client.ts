import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginRedirectPath } from "@/lib/auth/login-redirect";
import { getServerSession } from "@/lib/auth/session";
import { clearSessionTokenCookies } from "@/lib/auth/session-cookies";

const DEFAULT_BASE_URL = "http://localhost:3001";
/** Cold VPC Lambdas + Polygon can exceed a few seconds; dashboard chains multiple calls per request. */
const DEFAULT_API_TIMEOUT_MS = 55_000;
/** Header set by `middleware.ts` so server-side code can capture the user's current path for `?next=`. */
const PATHNAME_HEADER = "x-stocvest-pathname";

/**
 * STOCVEST Lambda HTTP API base (no trailing slash).
 * Prefer `STOCVEST_API_BASE_URL` on Vercel so server rendering does not rely on NEXT_PUBLIC_* (build-time only).
 */
export function apiBaseUrl(): string {
  const a = typeof process.env.STOCVEST_API_BASE_URL === "string" ? process.env.STOCVEST_API_BASE_URL.trim() : "";
  const b =
    typeof process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL === "string"
      ? process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL.trim()
      : "";
  const raw = a || b || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/** Read the request pathname (with search) propagated by middleware; null when called outside a request. */
function currentRequestPath(): string | null {
  try {
    const value = headers().get(PATHNAME_HEADER);
    return value && value.startsWith("/") ? value : null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const session = getServerSession();
  const headersOut = new Headers(init?.headers || {});
  headersOut.set("content-type", "application/json");
  if (session?.token) {
    headersOut.set("authorization", `Bearer ${session.token}`);
  }

  const timeoutSignal = AbortSignal.timeout(DEFAULT_API_TIMEOUT_MS);
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: headersOut,
    cache: "no-store",
    // Keep caller signal if provided; otherwise apply default request timeout.
    signal: init?.signal ?? timeoutSignal
  }).catch((error: unknown) => {
    console.error("Unable to connect. Check your connection.", error);
    return null;
  });
  if (!response) {
    return null;
  }

  if (response.status === 401) {
    try {
      clearSessionTokenCookies();
    } catch {
      // Best effort in contexts where cookie mutation is restricted.
    }
    redirect(loginRedirectPath("expired", currentRequestPath()));
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
