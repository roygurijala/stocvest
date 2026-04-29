import { getServerSession } from "@/lib/auth/session";

const DEFAULT_BASE_URL = "http://localhost:3001";

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API request failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}
