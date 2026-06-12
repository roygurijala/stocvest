import { describe, expect, test } from "vitest";
import { buildGapRows } from "@/lib/scanner/terminal/scanner-terminal-model";
import {
  classifyGapTimeHorizon,
  gapTimeHorizonLabel
} from "@/lib/scanner/gap-time-horizon";
import type { GapIntelligenceItem } from "@/lib/api/scanner";

function gapItem(overrides: Partial<GapIntelligenceItem>): GapIntelligenceItem {
  return {
    symbol: "TEST",
    company_name: "Test Co",
    gap_pct: 5,
    gap_dollars: 1,
    prev_close: 100,
    current_price: 105,
    volume: 1_000_000,
    volume_vs_avg: 2,
    gap_quality_score: 70,
    catalyst: null,
    has_catalyst: false,
    no_catalyst_warning: null,
    ...overrides
  };
}

describe("gap-time-horizon", () => {
  test("classifyGapTimeHorizon marks catalyst gaps multi-session", () => {
    expect(classifyGapTimeHorizon({ hasCatalyst: true, modeBestFit: "day" })).toBe("multi_session");
    expect(gapTimeHorizonLabel("multi_session")).toBe("Multi-session catalyst");
  });

  test("classifyGapTimeHorizon marks momentum gaps intraday", () => {
    expect(classifyGapTimeHorizon({ hasCatalyst: false, modeBestFit: "day" })).toBe("intraday");
    expect(gapTimeHorizonLabel("intraday")).toBe("Intraday window only");
  });

  test("buildGapRows ignores desk mode filter", () => {
    const rows = buildGapRows(
      [
        gapItem({ symbol: "SATS", mode_best_fit: "swing", has_catalyst: true }),
        gapItem({ symbol: "TNGX", mode_best_fit: "day", gap_pct: 53 })
      ],
      { mode: "day", state: "all", watchlistOnly: false, query: "" }
    );
    expect(rows.map((r) => r.symbol)).toEqual(["SATS", "TNGX"]);
    expect(rows[0]?.timeHorizon).toBe("multi_session");
    expect(rows[1]?.timeHorizon).toBe("intraday");
  });
});
