/**
 * BFF: position candidates degrade missing-route 404 / 5xx to an empty 200 envelope
 * so /dashboard/invest can retry instead of treating API Gateway 404 as a hard fail.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const stocvestAuthedFetchMock = vi.fn();

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: stocvestAuthedFetchMock
}));

describe("BFF: position candidates", () => {
  beforeEach(() => {
    stocvestAuthedFetchMock.mockReset();
  });

  test("upstream 404 (missing API Gateway route) -> degraded 200", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })
    );
    const { GET } = await import("@/app/api/stocvest/signals/position/candidates/route");
    const res = await GET(new Request("http://localhost/api/stocvest/signals/position/candidates?tier=gem"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[]; degraded?: boolean };
    expect(body.candidates).toEqual([]);
    expect(body.degraded).toBe(true);
  });

  test("upstream 504 -> degraded 200", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(new Response("Gateway Timeout", { status: 504 }));
    const { GET } = await import("@/app/api/stocvest/signals/position/candidates/route");
    const res = await GET(new Request("http://localhost/api/stocvest/signals/position/candidates"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { degraded?: boolean };
    expect(body.degraded).toBe(true);
  });

  test("proxies 401 so the client can refresh the session", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })
    );
    const { GET } = await import("@/app/api/stocvest/signals/position/candidates/route");
    const res = await GET(new Request("http://localhost/api/stocvest/signals/position/candidates"));
    expect(res.status).toBe(401);
  });

  test("proxies a successful upstream payload", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "position",
          tier: "gem",
          candidates: [{ symbol: "AAPL", tier: "gem", rank: 80 }],
          count: 1,
          universe_size: 25,
          cached: true
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const { GET } = await import("@/app/api/stocvest/signals/position/candidates/route");
    const res = await GET(new Request("http://localhost/api/stocvest/signals/position/candidates?tier=gem"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; candidates: { symbol: string }[] };
    expect(body.count).toBe(1);
    expect(body.candidates[0].symbol).toBe("AAPL");
  });
});
