import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fetchUserEvaluatedSignals, fetchUserSignalHistoryPage } from "@/lib/api/public-signals";

// Lock-in tests for the Mode Separation safety perimeter at the signals API
// layer. The Signals page operates in exactly one trading mode at a time, and
// the past-signals history list MUST be mode-isolated — never a combined
// swing+day ledger. These tests guard the wire path:
//
//   signals-page-client.tsx
//     → fetchUserEvaluatedSignals({ mode: tradingMode })
//       → fetchUserSignalHistoryPage({ mode })
//         → GET /api/stocvest/signals/me/history?mode=<mode>
//
// Any future regression that drops `mode` from this chain would silently mix
// swing and day rows on a single-engine view, violating the prompt's rule
// that "history entries are associated with exactly one mode at a time".

describe("signals-page mode plumbing (API layer)", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], next_cursor: null, page_size: 25 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetchUserSignalHistoryPage forwards mode=swing as a URL query param", async () => {
    await fetchUserSignalHistoryPage({ mode: "swing", days: 30, pageSize: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("mode=swing");
    expect(calledUrl).toContain("days=30");
    expect(calledUrl).not.toContain("mode=day");
  });

  test("fetchUserSignalHistoryPage forwards mode=day as a URL query param", async () => {
    await fetchUserSignalHistoryPage({ mode: "day", days: 30, pageSize: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("mode=day");
    expect(calledUrl).not.toContain("mode=swing");
  });

  test("fetchUserSignalHistoryPage omits mode when no mode is supplied (legacy contract)", async () => {
    // The Signals history tab MUST always supply a mode after this change, but
    // other callers (e.g. dashboard widgets that want a mode-agnostic recent
    // feed) may still call without one. Lock in that the omission is honoured
    // — i.e., no fabricated default mode leaks into the query string.
    await fetchUserSignalHistoryPage({ days: 30, pageSize: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).not.toMatch(/[?&]mode=/);
  });

  test("fetchUserEvaluatedSignals forwards mode through to every paginated page request", async () => {
    // The aggregator paginates multiple times; the mode must be on EVERY
    // page fetch, not just the first.
    let callIdx = 0;
    fetchMock.mockImplementation(async () => {
      callIdx += 1;
      if (callIdx === 1) {
        return new Response(
          JSON.stringify({
            items: [
              { symbol: "AAPL", bias: "long", timestamp_iso: "2026-05-01T12:00:00Z" }
            ],
            next_cursor: "cursor-page-2",
            page_size: 100
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ items: [], next_cursor: null, page_size: 100 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await fetchUserEvaluatedSignals({ days: 30, mode: "swing" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const calledUrl = String(call?.[0] ?? "");
      expect(calledUrl).toContain("mode=swing");
    }
  });

  test("fetchUserEvaluatedSignals does NOT swap to the other engine mid-pagination", async () => {
    // Lock-in: ensure no clever code path "balances" pages across modes.
    // Every paginated call must carry the same mode the caller asked for.
    let callIdx = 0;
    fetchMock.mockImplementation(async () => {
      callIdx += 1;
      if (callIdx === 1) {
        return new Response(
          JSON.stringify({ items: [], next_cursor: "c2", page_size: 100 }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ items: [], next_cursor: null, page_size: 100 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await fetchUserEvaluatedSignals({ days: 30, mode: "day" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const calledUrl = String(call?.[0] ?? "");
      expect(calledUrl).toContain("mode=day");
      expect(calledUrl).not.toContain("mode=swing");
    }
  });
});
