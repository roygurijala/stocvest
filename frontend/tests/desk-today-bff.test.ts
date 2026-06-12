/**
 * BFF: GET /api/stocvest/desk/today — retries upstream 503 then degrades to cache_miss.
 */

import { NextRequest } from "next/server";
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("BFF: GET /api/stocvest/desk/today", () => {
  test("passes through successful upstream payload", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonResponse({ mode: "day", source: "cache", data: { discovery: [] } })
    );
    const { GET } = await import("@/app/api/stocvest/desk/today/route");
    const res = await GET(new NextRequest("http://test.local/api/stocvest/desk/today?mode=day"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("cache");
  });

  test("upstream 503 after retries degrades to cache_miss 200", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "Service Unavailable" }), { status: 503 })
    );
    const { GET } = await import("@/app/api/stocvest/desk/today/route");
    const pending = GET(new NextRequest("http://test.local/api/stocvest/desk/today?mode=day"));
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("day");
    expect(body.source).toBe("cache_miss");
    expect(body.data).toBeNull();
    expect(body.degraded).toBe(true);
    expect(mocks.stocvestAuthedFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("upstream 401 passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonResponse({ message: "Unauthorized" }, 401)
    );
    const { GET } = await import("@/app/api/stocvest/desk/today/route");
    const res = await GET(new NextRequest("http://test.local/api/stocvest/desk/today?mode=swing"));
    expect(res.status).toBe(401);
  });
});
