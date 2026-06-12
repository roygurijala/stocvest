import { UPSTREAM_UNAVAILABLE_STATUSES } from "@/lib/bff/read-route-degrade";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser fetch to same-origin BFF with backoff on cold Lambda 502/503/504. */
export async function fetchBffWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    last = await fetch(url, init);
    if (last.ok || !UPSTREAM_UNAVAILABLE_STATUSES.has(last.status) || attempt === MAX_ATTEMPTS - 1) {
      return last;
    }
    await sleep(RETRY_BASE_MS * (attempt + 1));
  }
  return last!;
}
