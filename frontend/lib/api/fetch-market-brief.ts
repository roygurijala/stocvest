export interface MarketBriefNarrative {
  available: boolean;
  narrative: string | null;
  generatedAt: string | null;
  marketState: string | null;
}

/**
 * GET /v1/market/brief — the cached, AI-written plain-English market narrative.
 *
 * Routed through the same-origin Next.js proxy (`/api/stocvest/market/brief`) so the
 * server attaches the httpOnly session token. Returns `null` on any failure (including
 * pre-deploy 404), so callers fall back to the deterministic on-device summary.
 */
export async function fetchMarketBriefNarrative(): Promise<MarketBriefNarrative | null> {
  const res = await fetch("/api/stocvest/market/brief", {
    method: "GET",
    cache: "no-store"
  }).catch(() => null);
  if (!res || !res.ok) {
    return null;
  }
  try {
    const data = (await res.json()) as {
      available?: boolean;
      narrative?: string | null;
      generated_at?: string | null;
      market_state?: string | null;
    };
    return {
      available: Boolean(data.available && data.narrative),
      narrative: data.narrative ?? null,
      generatedAt: data.generated_at ?? null,
      marketState: data.market_state ?? null
    };
  } catch {
    return null;
  }
}
