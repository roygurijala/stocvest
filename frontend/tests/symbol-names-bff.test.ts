import { beforeEach, describe, expect, test, vi } from "vitest";

const stocvestAuthedFetchMock = vi.fn();

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: stocvestAuthedFetchMock
}));

describe("symbol names BFF", () => {
  beforeEach(() => {
    stocvestAuthedFetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  test("falls back to Polygon when upstream is unavailable", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.polygon.io/v3/reference/tickers/DELL")) {
          return new Response(JSON.stringify({ results: { name: "Dell Technologies Inc." } }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch
    );
    process.env.POLYGON_API_KEY = "test-key";

    const { GET } = await import("@/app/api/stocvest/market/symbol-names/route");
    const res = await GET(new Request("http://localhost/api/stocvest/market/symbol-names?symbols=DELL"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { names: Record<string, string> };
    expect(body.names.DELL).toBe("Dell Technologies Inc.");
  });

  test("returns degraded when upstream and Polygon both fail", async () => {
    stocvestAuthedFetchMock.mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })) as typeof fetch);
    delete process.env.POLYGON_API_KEY;

    const { GET } = await import("@/app/api/stocvest/market/symbol-names/route");
    const res = await GET(new Request("http://localhost/api/stocvest/market/symbol-names?symbols=GS"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { names: Record<string, string>; degraded?: boolean };
    expect(body.names).toEqual({});
    expect(body.degraded).toBe(true);
  });
});
