import {
  BFF_READ_MAX_ATTEMPTS,
  BFF_READ_RETRY_BASE_MS,
  isUpstreamUnavailable
} from "@/lib/bff/bff-retry-config";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";

export { isUpstreamUnavailable } from "@/lib/bff/bff-retry-config";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Authenticated upstream GET with short linear backoff on 502/503/504.
 * Used by read-only BFF routes before returning degraded empty payloads.
 */
export async function stocvestAuthedReadWithRetry(path: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < BFF_READ_MAX_ATTEMPTS; attempt++) {
    try {
      last = await stocvestAuthedFetch(path, { ...init, method: init?.method ?? "GET" });
    } catch (err) {
      if (attempt === BFF_READ_MAX_ATTEMPTS - 1) throw err;
      await sleep(BFF_READ_RETRY_BASE_MS * (attempt + 1));
      continue;
    }
    if (last.ok || !isUpstreamUnavailable(last.status) || attempt === BFF_READ_MAX_ATTEMPTS - 1) {
      return last;
    }
    await sleep(BFF_READ_RETRY_BASE_MS * (attempt + 1));
  }
  return last!;
}
