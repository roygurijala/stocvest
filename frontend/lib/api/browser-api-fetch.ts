import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 55_000;

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

/** JSON API fetch for Client Components (no `next/headers` / server session). */
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
    if (typeof window !== "undefined") {
      window.location.assign("/login?message=Session%20expired.%20Please%20sign%20in%20again.");
    }
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
