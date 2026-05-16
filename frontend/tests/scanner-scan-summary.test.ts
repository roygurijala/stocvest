import { describe, expect, it } from "vitest";
import {
  buildScannerNextActions,
  buildScannerScanSummary,
  nearRowsFromSetups
} from "@/lib/scanner-scan-summary";
import { parseScannerSetupsDeskResponse } from "@/lib/scanner-setups-response";

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
});
