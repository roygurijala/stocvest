import { describe, expect, test } from "vitest";
import { buildWatchlistRadarRows } from "@/lib/dashboard/watchlist-radar";

const colors = {
  accent: "#38bdf8",
  bullish: "#4ade80",
  bearish: "#f87171",
  caution: "#fbbf24",
  textMuted: "#94a3b8"
};

describe("buildWatchlistRadarRows desk context", () => {
  test("AMD-style row uses bearish market hold copy when bearish", () => {
    const rows = buildWatchlistRadarRows({
      symbols: ["AMD"],
      rowForSymbol: () => ({
        progress_band: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        state: "actionable",
        label: "Actionable"
      }),
      snapshotForSymbol: () => undefined,
      colors,
      mode: "swing",
      desk: { regimeLabel: "Bearish", systemSuppressed: true }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attentionReason).toBe("Strong setup — bearish market");
    expect(rows[0]?.alignmentLine).toContain("Strong");
  });
});
