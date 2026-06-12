/**
 * BFF: watchlists read routes degrade 503 to empty 200 payloads.
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("BFF: watchlists read degrade", () => {
  test("GET /watchlists upstream 503 -> empty watchlists 200", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValue(new Response("{}", { status: 503 }));
    const { GET } = await import("@/app/api/stocvest/watchlists/route");
    const pending = GET();
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.watchlists).toEqual([]);
    expect(body.degraded).toBe(true);
  });

  test("GET /watchlists/default/symbols upstream 503 -> empty symbols 200", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValue(new Response("{}", { status: 503 }));
    const { GET } = await import("@/app/api/stocvest/watchlists/default/symbols/route");
    const pending = GET();
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbols).toEqual([]);
    expect(body.degraded).toBe(true);
  });
});
