import { beforeEach, describe, expect, test, vi } from "vitest";

const stocvestAuthedFetchMock = vi.fn();

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: stocvestAuthedFetchMock
}));

describe("etf constituents BFF", () => {
  beforeEach(() => {
    stocvestAuthedFetchMock.mockReset();
  });

  test("returns degraded empty payload when upstream is 503", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Service Unavailable" }), { status: 503 })
    );
    const { GET } = await import("@/app/api/stocvest/market/etf-constituents/route");
    const res = await GET(new Request("http://localhost/api/stocvest/market/etf-constituents?symbol=XLE"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      etf: string;
      source: string;
      constituents: unknown[];
      degraded?: boolean;
    };
    expect(body.etf).toBe("XLE");
    expect(body.constituents).toEqual([]);
    expect(body.degraded).toBe(true);
  });

  test("proxies successful upstream payload", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          etf: "XLE",
          source: "etf_global",
          holdings_as_of: "2025-09-18",
          constituents: [{ symbol: "XOM", name: "Exxon Mobil Corporation", weight: 0.22, rank: 1 }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const { GET } = await import("@/app/api/stocvest/market/etf-constituents/route");
    const res = await GET(new Request("http://localhost/api/stocvest/market/etf-constituents?symbol=XLE"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; holdings_as_of?: string };
    expect(body.source).toBe("etf_global");
    expect(body.holdings_as_of).toBe("2025-09-18");
  });
});
