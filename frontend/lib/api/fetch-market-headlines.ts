import type { NewsPayload } from "@/lib/api/market";

/**
 * GET /v1/market/news (no `symbol`) — the market-intelligence feed.
 *
 * Routed through the same-origin Next.js proxy (`/api/stocvest/market/news`) so the
 * server attaches the httpOnly session token — the same path the working dashboard
 * endpoints use. A direct browser call to the API host can't carry valid auth and
 * silently 401s, leaving the brief's headlines blank.
 *
 * The no-symbol variant returns impact-analyzed, relevance-ranked, publisher-diverse
 * market headlines (`{ headlines: [...] }`), each with a plain-English `impact_summary`.
 */
export async function fetchMarketHeadlines(limit = 12): Promise<NewsPayload[]> {
  const res = await fetch(`/api/stocvest/market/news?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    cache: "no-store"
  }).catch(() => null);
  if (!res || !res.ok) {
    return [];
  }
  try {
    const data = (await res.json()) as { headlines?: NewsPayload[] };
    return Array.isArray(data.headlines) ? data.headlines : [];
  } catch {
    return [];
  }
}
