import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";

import type { SnapshotPayload } from "./market";

const DEFAULT_BASE_URL = "http://localhost:3001";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_STOCVEST_API_BASE_URL || DEFAULT_BASE_URL;
}

/** GET /v1/market/snapshot — safe in Client Components (no `next/headers`). */
export async function fetchSymbolSnapshot(symbol: string): Promise<SnapshotPayload | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return null;
  }
  const token = readWsTokenFromDocumentCookie();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(
      `${apiBaseUrl()}/v1/market/snapshot?symbol=${encodeURIComponent(sym)}`,
      { method: "GET", credentials: "include", headers, cache: "no-store" }
    );
    if (!res.ok) {
      return null;
    }
    const row = (await res.json()) as SnapshotPayload;
    return row ?? null;
  } catch {
    return null;
  }
}
