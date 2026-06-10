import { describe, expect, test, vi, beforeEach } from "vitest";
import { refreshTradingRoomSidebarMaturation } from "@/lib/dashboard/trading-room/trading-room-sidebar-refresh";

vi.mock("@/lib/watchlist-maturation-prime", () => ({
  refreshWatchlistSymbolMaturationDesk: vi.fn(async () => true)
}));

describe("refreshTradingRoomSidebarMaturation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("maturation-summary") && url.includes("mode=swing")) {
          return {
            ok: true,
            json: async () => ({
              by_symbol: {
                CBRL: {
                  bias: "long",
                  last_evaluated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
                },
                FRESH: {
                  bias: "long",
                  last_evaluated_at: new Date().toISOString()
                }
              }
            })
          };
        }
        return { ok: false, json: async () => ({}) };
      })
    );
  });

  test("re-composites all symbols when maxAgeMs is zero", async () => {
    const { refreshWatchlistSymbolMaturationDesk } = await import("@/lib/watchlist-maturation-prime");
    const result = await refreshTradingRoomSidebarMaturation(["CBRL", "FRESH"], false, {
      maxAgeMs: 0,
      maxSymbols: 2
    });
    expect(result.refreshed.sort()).toEqual(["CBRL", "FRESH"]);
    expect(refreshWatchlistSymbolMaturationDesk).toHaveBeenCalledTimes(2);
  });

  test("re-composites symbols older than max age", async () => {
    const { refreshWatchlistSymbolMaturationDesk } = await import("@/lib/watchlist-maturation-prime");
    const result = await refreshTradingRoomSidebarMaturation(["CBRL"], false, {
      maxAgeMs: 10 * 60 * 1000
    });
    expect(result.refreshed).toEqual(["CBRL"]);
    expect(refreshWatchlistSymbolMaturationDesk).toHaveBeenCalledWith("CBRL", "swing");
  });
});
