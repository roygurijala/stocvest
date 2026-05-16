import { describe, expect, it } from "vitest";
import {
  buildScannerNextActions,
  buildScannerScanSummary,
  buildWatchlistProgressionRows,
  nearRowsFromSetups
} from "@/lib/scanner-scan-summary";
import { mergeDeskSetupBundles, parseScannerSetupsDeskResponse } from "@/lib/scanner-setups-response";

describe("scanner-scan-summary", () => {
  it("parses v2 setups bundle", () => {
    const parsed = parseScannerSetupsDeskResponse({
      qualifying: [{ symbol: "AAPL", score: 0.6, direction: "long", triggers: ["a"] }],
      near_qualification: [
        {
          symbol: "NVDA",
          score: 0.4,
          direction: "long",
          triggers: ["a", "b", "c"],
          qualification_tier: "near",
          alignment: { aligned: 3, total: 6, label: "3/6 aligned" }
        }
      ]
    });
    expect(parsed.qualifying).toHaveLength(1);
    expect(parsed.nearQualification).toHaveLength(1);
  });

  it("builds scan summary with unified quiet line", () => {
    const summary = buildScannerScanSummary({
      scannedAtIso: new Date().toISOString(),
      overview: {
        setups: [],
        gapIntelligence: [],
        regimeLabel: "Neutral",
        spyPct: 0.1,
        qqqPct: -0.1,
        swingUniverseSymbolCount: 120,
        gapIntelligenceSnapshotSymbolCount: 80,
        watchlistStatus: { monitored: 5, actionable: 0, developing: 2, inactive: 3 }
      },
      nearQualificationSetups: [
        {
          symbol: "AMD",
          score: 0.42,
          direction: "long",
          triggers: ["a", "b"],
          scanner_mode: "swing_daily"
        }
      ],
      watchlistProgression: []
    });
    expect(summary.qualifying.total).toBe(0);
    expect(summary.near_qualification).toHaveLength(1);
    expect(summary.quiet.unified_headline).toContain("close");
    const actions = buildScannerNextActions(summary);
    expect(actions.some((a) => a.id === "near")).toBe(true);
  });

  it("maps near rows with alignment fallback", () => {
    const rows = nearRowsFromSetups([
      {
        symbol: "TSLA",
        score: 0.41,
        direction: "long",
        triggers: ["orb_breakout_long", "vwap_reclaim"],
        timestamp_iso: "2026-05-16T14:00:00Z"
      }
    ]);
    expect(rows[0]?.alignment?.label).toBe("2/6 aligned");
  });

  it("merges swing and day near-qualification bundles by score", () => {
    const merged = mergeDeskSetupBundles(
      parseScannerSetupsDeskResponse({
        qualifying: [],
        near_qualification: [
          { symbol: "LOW", score: 0.3, direction: "long", triggers: ["a"], scanner_mode: "swing_daily" }
        ]
      }),
      parseScannerSetupsDeskResponse({
        qualifying: [],
        near_qualification: [{ symbol: "HIGH", score: 0.44, direction: "long", triggers: ["a", "b"] }]
      })
    );
    expect(merged.nearQualification[0]?.symbol).toBe("HIGH");
    expect(merged.nearQualification.map((r) => r.symbol)).toEqual(["HIGH", "LOW"]);
  });

  it("buildWatchlistProgressionRows respects desk tracking and maturation states", () => {
    const rows = buildWatchlistProgressionRows(
      ["AAPL", "MSFT"],
      { AAPL: { swing: true, day: false }, MSFT: { swing: true, day: true } },
      {
        AAPL: {
          symbol: "AAPL",
          state: "developing",
          readiness_label: "Swing developing",
          label: "Developing"
        }
      },
      {
        MSFT: {
          symbol: "MSFT",
          state: "re_evaluating",
          readiness_label: "Day re-evaluating",
          label: "Re-evaluating"
        }
      },
      true,
      5
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.symbol === "AAPL")?.desk).toBe("swing");
    expect(rows.find((r) => r.symbol === "MSFT")?.desk).toBe("day");
  });

  it("buildScannerNextActions omits watchlist tracking when nothing monitored", () => {
    const summary = buildScannerScanSummary({
      scannedAtIso: new Date().toISOString(),
      overview: {
        setups: [{ symbol: "X", score: 0.9, direction: "long", triggers: [], timestamp_iso: "x" }],
        gapIntelligence: [],
        regimeLabel: "Neutral",
        spyPct: null,
        qqqPct: null,
        swingUniverseSymbolCount: null,
        gapIntelligenceSnapshotSymbolCount: null,
        watchlistStatus: { monitored: 0, actionable: 0, developing: 0, inactive: 0 }
      },
      nearQualificationSetups: [],
      watchlistProgression: []
    });
    const ids = buildScannerNextActions(summary).map((a) => a.id);
    expect(ids).toContain("qualifying");
    expect(ids).not.toContain("tracking");
  });
});
