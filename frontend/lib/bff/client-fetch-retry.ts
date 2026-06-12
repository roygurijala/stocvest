import {
  BFF_READ_MAX_ATTEMPTS,
  BFF_READ_RETRY_BASE_MS,
  isUpstreamUnavailable
} from "@/lib/bff/bff-retry-config";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser fetch to same-origin BFF with backoff on cold Lambda 502/503/504. */
export async function fetchBffWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < BFF_READ_MAX_ATTEMPTS; attempt++) {
    last = await fetch(url, init);
    if (last.ok || !isUpstreamUnavailable(last.status) || attempt === BFF_READ_MAX_ATTEMPTS - 1) {
      return last;
    }
    await sleep(BFF_READ_RETRY_BASE_MS * (attempt + 1));
  }
  return last!;
}
