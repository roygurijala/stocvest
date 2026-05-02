import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("scanner API overview", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchScannerOverview orchestrates scanner endpoints", async () => {
    const { fetchScannerOverview } = await import("@/lib/api/scanner");
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/v1/scanner/gap-intelligence") {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}")) as { snapshots: unknown };
        expect(body.snapshots).toEqual([]);
        return {
          items: [
            {
              symbol: "GAP1",
              company_name: "G1",
              gap_pct: 4,
              gap_dollars: 4,
              prev_close: 100,
              current_price: 104,
              volume: 1_000_000,
              volume_vs_avg: 2,
              gap_quality_score: 80,
              catalyst: null,
              has_catalyst: false,
              no_catalyst_warning: "x"
            }
          ]
        };
      }
      if (path.startsWith("/v1/market/snapshot?symbol=")) {
        const q = path.includes("?") ? path.split("?")[1] : "";
        const sym = new URLSearchParams(q).get("symbol") ?? "UNK";
        return {
          symbol: sym,
          prev_close: 100,
          pre_market_price: 104,
          day_volume: 1_000_000
        };
      }
      if (path.includes("/v1/market/bars?")) {
        return [
          {
            timestamp: "2026-04-29T10:00:00+00:00",
            timeframe: "1min",
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 120000
          }
        ];
      }
      if (path === "/v1/signals/day/setups") {
        return [{ symbol: "GAP1", direction: "long", score: 0.7, triggers: [], timestamp_iso: "x" }];
      }
      if (path === "/v1/signals/day/briefing") {
        return {
          generated_at: "2026-04-29T12:00:00Z",
          conditions: {
            label: "CHOPPY",
            futures_spy_pct: 0.1,
            futures_qqq_pct: 0.1,
            vix_level: 19,
            vix_direction: "flat",
            regime: "Neutral"
          },
          economic_events: [],
          earnings_today: { message: "No earnings today" },
          top_watch: { message: "none" },
          best_setup: { setup_type: "High conviction only", guidance: "Wait." },
          pdt_status: { trades_used: 0, trades_remaining: 3, status: "clear", message: "ok" },
          title: "Morning Brief — 2026-04-29"
        };
      }
      throw new Error(`Unhandled path ${path}`);
    });

    const result = await fetchScannerOverview(null);
    expect(result.error).toBeUndefined();
    expect(result.gapIntelligence).toHaveLength(1);
    expect(result.morningBrief?.conditions.label).toBe("CHOPPY");
  });

  test("fetchScannerOverview handles scanner failures", async () => {
    const { fetchScannerOverview } = await import("@/lib/api/scanner");
    apiFetchMock.mockRejectedValueOnce(new Error("API request failed (500): scanner"));
    const result = await fetchScannerOverview(null);
    expect(result.error).toContain("500");
    expect(result.gapIntelligence).toHaveLength(0);
  });
});
