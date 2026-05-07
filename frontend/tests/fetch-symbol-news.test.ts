import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const readWsTokenMock = vi.fn(() => null as string | null);

vi.mock("@/lib/auth/ws-token-cookie", () => ({
  readWsTokenFromDocumentCookie: readWsTokenMock
}));

function panelArticle(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    title: "x",
    source: "polygon",
    source_label: "Polygon",
    published_at: "2026-01-01T00:00:00Z",
    sentiment_score: 0,
    sentiment_label: "neutral",
    catalyst_type: null,
    url: "https://example.com",
    is_recent: true,
    age_label: "1h ago",
    ...overrides
  };
}

describe("fetchSymbolNews", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    readWsTokenMock.mockReset();
    readWsTokenMock.mockReturnValue(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("requests symbol, days, and limit query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: "NVDA",
        has_recent_news: true,
        recent_cutoff_hours: 8,
        articles: [panelArticle({ id: "a1", title: "NVDA item" })],
        total_found: 1,
        oldest_included: "2026-01-01T00:00:00Z"
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    const rows = await fetchSymbolNews("nvda", 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("symbol=NVDA");
    expect(url).toContain("limit=10");
    expect(url).toContain("days=20");
    expect(url).toContain("recent_hours=8");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("NVDA item");
  });

  test("maps panel articles to NewsPayload for the requested symbol", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: "PINS",
        has_recent_news: false,
        recent_cutoff_hours: 8,
        articles: [panelArticle({ id: "p1", title: "PINS engagement", sentiment_label: "bullish", sentiment_score: 0.5 })],
        total_found: 1,
        oldest_included: null
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    const rows = await fetchSymbolNews("PINS", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].article_id).toBe("p1");
    expect(rows[0].tickers).toEqual(["PINS"]);
    expect(rows[0].sentiment).toBe("positive");
  });

  test("returns empty array for blank symbol without calling fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    const rows = await fetchSymbolNews("   ", 10);
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("swing newsTradingMode requests recent_hours=120", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: "AMD",
        has_recent_news: true,
        recent_cutoff_hours: 120,
        articles: [panelArticle({ id: "a2", title: "AMD item" })],
        total_found: 1,
        oldest_included: null
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    await fetchSymbolNews("amd", 10, { newsTradingMode: "swing" });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("recent_hours=120");
  });
});
