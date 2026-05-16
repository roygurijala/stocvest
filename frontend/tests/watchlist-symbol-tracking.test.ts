import { describe, expect, test, vi, afterEach } from "vitest";

import { coerceDeskTracking, defaultDeskTracking, saveSymbolDeskTracking } from "@/lib/watchlist-symbol-tracking";

describe("watchlist-symbol-tracking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("defaultDeskTracking respects dual desk", () => {
    expect(defaultDeskTracking(true)).toEqual({ swing: true, day: true });
    expect(defaultDeskTracking(false)).toEqual({ swing: true, day: false });
  });

  test("coerceDeskTracking parses API shape", () => {
    expect(coerceDeskTracking({ swing: true, day: false }, true)).toEqual({ swing: true, day: false });
  });

  test("saveSymbolDeskTracking PATCHes BFF route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveSymbolDeskTracking("wl-1", "TSLA", { swing: true, day: false }, true);
    expect(result.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/tracking");
  });
});
