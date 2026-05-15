/**
 * BFF: `GET /api/stocvest/alerts/history` — forwards whitelisted query params to
 * `GET /v1/alerts/history` via `stocvestAuthedFetch`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stocvestAuthedFetch: vi.fn()
}));

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: mocks.stocvestAuthedFetch
}));

beforeEach(() => {
  mocks.stocvestAuthedFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function jsonUpstreamResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });
}

function lastUpstreamPath(): string {
  const call = mocks.stocvestAuthedFetch.mock.calls.at(-1);
  if (!call) throw new Error("stocvestAuthedFetch was not called");
  return String(call[0]);
}

describe("BFF: GET /api/stocvest/alerts/history", () => {
  test("forwards no query string without trailing '?'", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(jsonUpstreamResponse({ alerts: [] }));
    const { GET } = await import("@/app/api/stocvest/alerts/history/route");
    await GET(new Request("http://test.local/api/stocvest/alerts/history"));
    expect(lastUpstreamPath()).toBe("/v1/alerts/history");
  });

  test("forwards limit, alert_type, and symbols to upstream", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(jsonUpstreamResponse({ alerts: [] }));
    const { GET } = await import("@/app/api/stocvest/alerts/history/route");
    const res = await GET(
      new Request(
        "http://test.local/api/stocvest/alerts/history?limit=12&alert_type=watchlist_maturation&symbols=AAPL,MSFT"
      )
    );
    expect(res.status).toBe(200);
    const path = lastUpstreamPath();
    expect(path.startsWith("/v1/alerts/history?")).toBe(true);
    const u = new URL(path, "http://u.test");
    expect(u.searchParams.get("limit")).toBe("12");
    expect(u.searchParams.get("alert_type")).toBe("watchlist_maturation");
    expect(u.searchParams.get("symbols")).toBe("AAPL,MSFT");
  });

  test("upstream 400 passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Invalid alert_type: 'nope'" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );
    const { GET } = await import("@/app/api/stocvest/alerts/history/route");
    const res = await GET(
      new Request("http://test.local/api/stocvest/alerts/history?alert_type=nope")
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "Invalid alert_type: 'nope'" });
  });
});
