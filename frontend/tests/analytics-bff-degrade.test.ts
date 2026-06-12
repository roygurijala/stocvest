/**
 * BFF: analytics + market read routes degrade 503 to empty 200 payloads.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

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

describe("BFF: setup-outcomes read degrade", () => {
  test("GET setup-outcomes upstream 503 -> empty stats 200", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValue(new Response("{}", { status: 503 }));
    const { GET } = await import("@/app/api/stocvest/analytics/setup-outcomes/route");
    const req = new NextRequest("http://localhost/api/stocvest/analytics/setup-outcomes?mode=swing&days=30");
    const pending = GET(req);
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(body.stats.total_events).toBe(0);
    expect(body.degraded).toBe(true);
  });
});

describe("BFF: vix-snapshot read degrade", () => {
  test("GET vix-snapshot upstream 503 -> null snapshot 200", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValue(new Response("{}", { status: 503 }));
    const { GET } = await import("@/app/api/stocvest/market/vix-snapshot/route");
    const pending = GET();
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toBeNull();
    expect(body.degraded).toBe(true);
  });
});
