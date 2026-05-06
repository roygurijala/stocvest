import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const readWsTokenMock = vi.fn(() => null as string | null);

vi.mock("@/lib/auth/ws-token-cookie", () => ({
  readWsTokenFromDocumentCookie: readWsTokenMock
}));

describe("fetchSymbolNews", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    readWsTokenMock.mockReset();
    readWsTokenMock.mockReturnValue(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("requests symbol and limit query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        headlines: [
          { article_id: "a1", title: "NVDA item", tickers: ["NVDA"], published_at: "2026-01-01T00:00:00Z", url: "u" }
        ]
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    const rows = await fetchSymbolNews("nvda", 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("symbol=NVDA");
    expect(url).toContain("limit=10");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("NVDA item");
  });

  test("keeps only articles whose tickers include the requested symbol", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        headlines: [
          {
            article_id: "c1",
            title: "COTY beat",
            tickers: ["COTY"],
            published_at: "2026-01-01T00:00:00Z",
            url: "u1"
          },
          {
            article_id: "p1",
            title: "PINS engagement",
            tickers: ["PINS"],
            published_at: "2026-01-01T01:00:00Z",
            url: "u2"
          }
        ]
      })
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    const rows = await fetchSymbolNews("PINS", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].article_id).toBe("p1");
  });

  test("returns empty array for blank symbol without calling fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSymbolNews } = await import("@/lib/api/fetch-symbol-news");
    const rows = await fetchSymbolNews("   ", 10);
    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
