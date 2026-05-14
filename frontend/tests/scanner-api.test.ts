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
          ],
          snapshot_symbol_count: 412
        };
      }
      if (path.startsWith("/v1/market/snapshots?")) {
        const q = path.includes("?") ? path.split("?")[1] : "";
        const syms = (new URLSearchParams(q).get("symbols") ?? "").split(",").filter(Boolean);
        return {
          snapshots: syms.map((sym) => ({
            symbol: sym,
            prev_close: 100,
            pre_market_price: 104,
            day_volume: 1_000_000
          }))
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
      if (path === "/v1/market/bars-batch") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          requests?: Array<{ symbol?: string }>;
        };
        const syms = (body.requests ?? []).map((r) => String(r.symbol ?? "").toUpperCase());
        const bar = {
          timestamp: "2026-04-29T10:00:00+00:00",
          timeframe: "1min",
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 120000
        };
        const bars_by_symbol: Record<string, typeof bar[]> = {};
        for (const s of syms) bars_by_symbol[s] = [bar];
        return { bars_by_symbol };
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

    const result = await fetchScannerOverview(null, [], { includeMorningBrief: true });
    expect(result.error).toBeUndefined();
    expect(result.gapIntelligence).toHaveLength(1);
    expect(result.morningBrief?.conditions.label).toBe("CHOPPY");
    // SPY + QQQ + one gap symbol — bars/swing universe; gap-intel may report full-feed scan size separately.
    expect(result.swingUniverseSymbolCount).toBe(3);
    expect(result.gapIntelligenceSnapshotSymbolCount).toBe(412);
  }, 25000);

  test("fetchScannerOverview handles scanner failures", async () => {
    const { fetchScannerOverview } = await import("@/lib/api/scanner");
    apiFetchMock.mockRejectedValueOnce(new Error("API request failed (500): scanner"));
    const result = await fetchScannerOverview(null, [], { includeMorningBrief: true });
    expect(result.error).toContain("500");
    expect(result.gapIntelligence).toHaveLength(0);
    expect(result.swingUniverseSymbolCount).toBeNull();
    expect(result.gapIntelligenceSnapshotSymbolCount).toBeNull();
  }, 25000);
});

describe("loadScannerDataWithoutBrief swing-only (dashboard)", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("test_dashboard_does_not_fetch_intraday (swing tuning skips day/setups)", async () => {
    const { loadScannerDataWithoutBrief } = await import("@/lib/api/scanner");
    const paths: string[] = [];
    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      paths.push(path);
      if (path === "/v1/signals/day/setups") {
        throw new Error("day/setups must not be requested in swing-only mode");
      }
      if (path === "/v1/scanner/gap-intelligence") {
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
      if (path.startsWith("/v1/market/snapshots?")) {
        const q = path.includes("?") ? path.split("?")[1] : "";
        const syms = (new URLSearchParams(q).get("symbols") ?? "").split(",").filter(Boolean);
        return {
          snapshots: syms.map((sym) => ({
            symbol: sym,
            prev_close: 100,
            pre_market_price: 104,
            day_volume: 1_000_000
          }))
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
      if (path === "/v1/market/bars-batch") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          requests?: Array<{ symbol?: string; timeframe?: string }>;
        };
        const syms = (body.requests ?? []).map((r) => String(r.symbol ?? "").toUpperCase());
        const tf = String(body.requests?.[0]?.timeframe ?? "1min");
        const bar = {
          timestamp: "2026-04-29T10:00:00+00:00",
          timeframe: tf,
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 120000
        };
        const bars_by_symbol: Record<string, typeof bar[]> = {};
        for (const s of syms) bars_by_symbol[s] = [bar];
        return { bars_by_symbol };
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
      if (path === "/v1/signals/swing/setups") {
        return [
          {
            symbol: "SW1",
            direction: "bullish",
            score: 0.82,
            triggers: ["ema50_cross_above_200"],
            timestamp_iso: "2026-05-01T12:00:00Z",
            scanner_mode: "swing_daily",
            pattern_maturity_days: 4
          }
        ];
      }
      throw new Error(`Unhandled path ${path}`);
    });

    const core = await loadScannerDataWithoutBrief(null, [], {
      maxUniverseSymbols: 24,
      intradayBarLimit: 60,
      parallelDefaultWatchlist: false,
      scannerSetupLoadMode: "swing",
      swingDailyBarLimit: 220,
      swingSetupsLimit: 4
    });
    expect(core.error).toBeUndefined();
    expect(paths.some((p) => p.includes("/v1/signals/day/setups"))).toBe(false);
    expect(paths.some((p) => p.includes("/v1/signals/swing/setups"))).toBe(true);
    const barsBatchCalls = apiFetchMock.mock.calls.filter((c) => c[0] === "/v1/market/bars-batch");
    const requests1min = barsBatchCalls.some(([, init]) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        requests?: Array<{ timeframe?: string }>;
      };
      return (body.requests ?? []).some((r) => String(r.timeframe ?? "") === "1min");
    });
    expect(requests1min).toBe(false);
    expect(core.setups).toHaveLength(1);
    expect(core.setups[0]?.scanner_mode).toBe("swing_daily");
  }, 25000);
});

describe("topSignalStrengthPercent", () => {
  test("blends confluence with pattern score when both exist", async () => {
    const { topSignalStrengthPercent } = await import("@/lib/api/scanner");
    expect(
      topSignalStrengthPercent({
        symbol: "AAPL",
        direction: "long",
        score: 0.55,
        triggers: [],
        timestamp_iso: "",
        confluence_score: 72
      })
    ).toBe(68);
  });

  test("falls back to pattern score when confluence is absent", async () => {
    const { topSignalStrengthPercent } = await import("@/lib/api/scanner");
    expect(
      topSignalStrengthPercent({
        symbol: "NVDA",
        direction: "short",
        score: 0.55,
        triggers: [],
        timestamp_iso: ""
      })
    ).toBe(55);
  });
});
