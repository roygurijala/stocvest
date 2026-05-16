import { describe, expect, it } from "vitest";

import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import { mergeScannerCoreIntoOverview } from "@/lib/scanner-overview-merge";

describe("mergeScannerCoreIntoOverview", () => {
  it("preserves scanSummary from scanner core load", () => {
    const scanSummary = buildScannerScanSummary({
      scannedAtIso: "2026-05-16T14:00:00.000Z",
      overview: {
        setups: [],
        gapIntelligence: [],
        regimeLabel: "Neutral",
        spyPct: 0.1,
        qqqPct: -0.1,
        swingUniverseSymbolCount: 100,
        gapIntelligenceSnapshotSymbolCount: 50,
        watchlistStatus: null
      },
      nearQualificationSetups: [
        {
          symbol: "NEAR1",
          direction: "long",
          score: 0.4,
          triggers: ["a", "b"],
          timestamp_iso: "x"
        }
      ],
      watchlistProgression: []
    });
    const merged = mergeScannerCoreIntoOverview(EMPTY_SCANNER_OVERVIEW, {
      gapIntelligence: [],
      setups: [],
      spyPct: 0.1,
      qqqPct: -0.1,
      regimeLabel: "Neutral",
      swingUniverseSymbolCount: 100,
      gapIntelligenceSnapshotSymbolCount: 50,
      watchlistStatus: null,
      scanSummary
    });
    expect(merged.scanSummary?.near_qualification[0]?.symbol).toBe("NEAR1");
    expect(merged.morningBrief).toBe(EMPTY_SCANNER_OVERVIEW.morningBrief);
  });

  it("clears scanSummary when core omits it", () => {
    const withSummary = {
      ...EMPTY_SCANNER_OVERVIEW,
      scanSummary: buildScannerScanSummary({
        scannedAtIso: "2026-05-16T14:00:00.000Z",
        overview: {
          setups: [{ symbol: "X", score: 0.9, direction: "long", triggers: [], timestamp_iso: "x" }],
          gapIntelligence: [],
          regimeLabel: "Neutral",
          spyPct: null,
          qqqPct: null,
          swingUniverseSymbolCount: null,
          gapIntelligenceSnapshotSymbolCount: null,
          watchlistStatus: null
        },
        nearQualificationSetups: [],
        watchlistProgression: []
      })
    };
    const merged = mergeScannerCoreIntoOverview(withSummary, {
      gapIntelligence: [],
      setups: [],
      spyPct: null,
      qqqPct: null,
      regimeLabel: "Neutral",
      swingUniverseSymbolCount: null,
      gapIntelligenceSnapshotSymbolCount: null,
      watchlistStatus: null,
      scanSummary: null
    });
    expect(merged.scanSummary).toBeNull();
  });
});
