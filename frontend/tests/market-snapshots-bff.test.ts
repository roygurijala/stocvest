import { beforeEach, describe, expect, test, vi } from "vitest";

const stocvestAuthedFetchMock = vi.fn();

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: stocvestAuthedFetchMock
}));

describe("market snapshots BFF", () => {
  beforeEach(() => {
    stocvestAuthedFetchMock.mockReset();
  });

  test("returns 200 with empty snapshots when upstream is 503", async () => {
    stocvestAuthedFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "Service Unavailable" }), { status: 503 })
    );
    const { GET } = await import("@/app/api/stocvest/market/snapshots/route");
    const res = await GET(new Request("http://localhost/api/stocvest/market/snapshots?symbols=AAPL"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshots: unknown[]; degraded?: boolean };
    expect(body.snapshots).toEqual([]);
    expect(body.degraded).toBe(true);
  });
});
