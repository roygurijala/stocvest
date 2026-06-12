import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

/** Upstream gateway/Lambda unavailable — safe to retry then degrade read routes. */
export const UPSTREAM_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

const MAX_READ_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isUpstreamUnavailable(status: number): boolean {
  return UPSTREAM_UNAVAILABLE_STATUSES.has(status);
}

/**
 * Authenticated upstream GET with short linear backoff on 502/503/504.
 * Used by read-only BFF routes before returning degraded empty payloads.
 */
export async function stocvestAuthedReadWithRetry(path: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
    try {
      last = await stocvestAuthedFetch(path, { ...init, method: init?.method ?? "GET" });
    } catch (err) {
      if (attempt === MAX_READ_ATTEMPTS - 1) throw err;
      await sleep(RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    if (last.ok || !isUpstreamUnavailable(last.status) || attempt === MAX_READ_ATTEMPTS - 1) {
      return last;
    }
    await sleep(RETRY_BASE_MS * (attempt + 1));
  }
  return last!;
}
