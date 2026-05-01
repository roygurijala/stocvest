import { getServerSession } from "@/lib/auth/session";
import { clearSessionTokenCookies } from "@/lib/auth/session-cookies";
import { redirect } from "next/navigation";

const DEFAULT_BASE_URL = "http://localhost:3001";

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const session = getServerSession();
  const headers = new Headers(init?.headers || {});
  headers.set("content-type", "application/json");
  if (session?.token) {
    headers.set("authorization", `Bearer ${session.token}`);
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store"
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
    redirect("/login?message=Session%20expired.%20Please%20sign%20in%20again.");
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
