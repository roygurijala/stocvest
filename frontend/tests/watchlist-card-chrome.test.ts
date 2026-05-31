import { describe, expect, test } from "vitest";
import {
  resolveWatchlistCardChrome,
  resolveWatchlistDirectionChip
} from "@/lib/watchlist-card-chrome";
import { WATCHLIST_DESK_OPEN } from "@/lib/dashboard/watchlist-radar-attention";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

const COLORS = {
  accent: "#38bdf8",
  bullish: "#22c55e",
  bearish: "#ef4444",
  caution: "#f59e0b",
  textMuted: "#94a3b8"
};

function row(partial: Partial<WatchlistMaturationRow>): WatchlistMaturationRow {
  return partial as WatchlistMaturationRow;
}

describe("resolveWatchlistDirectionChip", () => {
  test("long and short biases get distinct pills", () => {
    expect(resolveWatchlistDirectionChip(row({ bias: "long" }), COLORS)?.label).toBe("↑ Long");
    expect(resolveWatchlistDirectionChip(row({ bias: "short" }), COLORS)?.label).toBe("↓ Short");
    expect(resolveWatchlistDirectionChip(row({ bias: "neutral" }), COLORS)?.label).toBe("No edge");
  });
});

describe("resolveWatchlistCardChrome", () => {
  test("swing actionable stays green when session closed (plan)", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "actionable",
      row: row({ state: "actionable", layers_aligned: 6, layers_total: 6, bias: "long" }),
      blockers: [],
      desk: { ...WATCHLIST_DESK_OPEN, sessionMode: "closed" },
      planMode: "swing",
      colors: COLORS,
      attentionTier: "check_now"
    });
    expect(chrome.kind).toBe("actionable_plan");
    expect(chrome.borderLeft).toBe(COLORS.bullish);
    expect(chrome.badgeLabel).toBe("Plan");
  });

  test("day actionable is amber when session closed", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "actionable",
      row: row({ state: "actionable", layers_aligned: 6, layers_total: 6, bias: "long" }),
      blockers: [],
      desk: { ...WATCHLIST_DESK_OPEN, sessionMode: "closed" },
      planMode: "day",
      colors: COLORS,
      attentionTier: "check_now"
    });
    expect(chrome.kind).toBe("blocked");
    expect(chrome.borderLeft).toBe(COLORS.caution);
  });

  test("invalidated uses red border and status banner", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "invalidated",
      row: row({ state: "invalidated", layers_aligned: 2, layers_total: 6 }),
      blockers: [],
      desk: WATCHLIST_DESK_OPEN,
      planMode: "swing",
      colors: COLORS
    });
    expect(chrome.kind).toBe("invalidated");
    expect(chrome.borderLeft).toBe(COLORS.bearish);
    expect(chrome.statusBanner).toContain("invalidated");
  });

  test("swing 6/6 stays green when desk is quiet but regime neutral", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "actionable",
      row: row({ state: "actionable", layers_aligned: 6, layers_total: 6, bias: "long" }),
      blockers: [],
      desk: { regimeLabel: "Neutral", systemSuppressed: true, sessionMode: "closed" },
      planMode: "swing",
      colors: COLORS,
      attentionTier: "check_now"
    });
    expect(chrome.kind).toBe("actionable_plan");
    expect(chrome.borderLeft).toBe(COLORS.bullish);
  });

  test("6/6 on bearish desk is amber not green", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "actionable",
      row: row({ state: "actionable", layers_aligned: 6, layers_total: 6, bias: "long" }),
      blockers: [],
      desk: { regimeLabel: "Bearish", systemSuppressed: true, sessionMode: "live" },
      planMode: "swing",
      colors: COLORS,
      attentionTier: "check_now"
    });
    expect(chrome.kind).toBe("blocked");
    expect(chrome.borderLeft).toBe(COLORS.caution);
  });

  test("near ready with missing layers is amber", () => {
    const chrome = resolveWatchlistCardChrome({
      alignmentTier: "near_ready",
      row: row({ state: "developing", layers_aligned: 4, layers_total: 6 }),
      blockers: ["Macro"],
      desk: WATCHLIST_DESK_OPEN,
      planMode: "swing",
      colors: COLORS,
      attentionTier: "check_now"
    });
    expect(chrome.kind).toBe("blocked");
    expect(chrome.borderLeft).toBe(COLORS.caution);
  });
});
