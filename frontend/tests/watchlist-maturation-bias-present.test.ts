import { describe, expect, test } from "vitest";
import { formatAlignmentStatusLine } from "@/lib/alignment-display-tier";
import { resolveWatchlistRadarAttentionLine, WATCHLIST_DESK_OPEN } from "@/lib/dashboard/watchlist-radar-attention";
import {
  resolveWatchlistCardChrome,
  resolveWatchlistDirectionChip
} from "@/lib/watchlist-card-chrome";
import {
  WATCHLIST_BALANCED_NO_EDGE_LINE,
  watchlistSetupQualityPrefix
} from "@/lib/watchlist-maturation-bias-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

const COLORS = {
  accent: "#38bdf8",
  bullish: "#22c55e",
  bearish: "#ef4444",
  caution: "#f59e0b",
  textMuted: "#94a3b8"
};

describe("neutral high-alignment presentation", () => {
  test("alignment line says Balanced not Strong when bias neutral", () => {
    expect(
      formatAlignmentStatusLine({
        layersAligned: 6,
        layersTotal: 6,
        maturationState: "actionable",
        bias: "neutral"
      })
    ).toBe("Balanced");
    expect(
      formatAlignmentStatusLine({
        layersAligned: 6,
        layersTotal: 6,
        maturationState: "actionable",
        bias: "long"
      })
    ).toBe("Strong (6/6)");
  });

  test("direction chip shows No edge for neutral", () => {
    expect(resolveWatchlistDirectionChip({ bias: "neutral" } as WatchlistMaturationRow, COLORS)?.label).toBe(
      "No edge"
    );
  });

  test("neutral 6/6 does not get green ready chrome", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "actionable",
      row: { state: "actionable", layers_aligned: 6, layers_total: 6, bias: "neutral" } as WatchlistMaturationRow,
      blockers: [],
      desk: { ...WATCHLIST_DESK_OPEN, sessionMode: "closed" },
      planMode: "swing",
      colors: COLORS,
      attentionTier: "check_now"
    });
    expect(chrome.badgeLabel).toBe("Balanced");
    expect(chrome.borderLeft).toBe(COLORS.textMuted);
    expect(chrome.directionChip?.label).toBe("No edge");
  });

  test("attention line for neutral closed session", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { bias: "neutral", layers_aligned: 6, layers_total: 6, progress_band: "actionable" },
      alignmentTier: "actionable",
      blockers: [],
      desk: { ...WATCHLIST_DESK_OPEN, sessionMode: "closed" }
    });
    expect(line).toBe("Balanced — session closed");
  });

  test("attention line for neutral live clear desk", () => {
    const line = resolveWatchlistRadarAttentionLine({
      tier: "check_now",
      row: { bias: "neutral", layers_aligned: 6, layers_total: 6 },
      alignmentTier: "actionable",
      blockers: [],
      desk: WATCHLIST_DESK_OPEN
    });
    expect(line).toBe(WATCHLIST_BALANCED_NO_EDGE_LINE);
  });

  test("setup prefix follows bias", () => {
    expect(watchlistSetupQualityPrefix("long")).toBe("Strong setup");
    expect(watchlistSetupQualityPrefix("neutral")).toBe("Balanced");
  });
});
