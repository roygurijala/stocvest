import { describe, expect, test } from "vitest";

import {
  buildWatchlistCardModel,
  formatEvaluatedAgo,
  formatWatchlistTierHeaderHint,
  groupSymbolsIntoAttentionTiers,
  resolveWatchlistAttentionTier,
  sortSymbolsInAttentionTier
} from "@/lib/watchlist-decision-card-present";
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

describe("resolveWatchlistAttentionTier", () => {
  test("actionable / 6 layers → check_now", () => {
    expect(
      resolveWatchlistAttentionTier(row({ state: "actionable", layers_aligned: 6, layers_total: 6 }))
    ).toBe("check_now");
  });

  test("4 layers → check_now (near ready)", () => {
    expect(
      resolveWatchlistAttentionTier(row({ state: "developing", layers_aligned: 4, layers_total: 6 }))
    ).toBe("check_now");
  });

  test("3 layers → getting_close", () => {
    expect(
      resolveWatchlistAttentionTier(row({ state: "developing", layers_aligned: 3, layers_total: 6 }))
    ).toBe("getting_close");
  });

  test("1 layer → tracking", () => {
    expect(
      resolveWatchlistAttentionTier(row({ state: "not_aligned", layers_aligned: 1, layers_total: 6 }))
    ).toBe("tracking");
  });
});

describe("buildWatchlistCardModel", () => {
  test("near-ready with blockers surfaces momentum and blockers", () => {
    const model = buildWatchlistCardModel(
      "AAPL",
      row({
        state: "developing",
        layers_aligned: 3,
        layers_total: 6,
        previous_layers_aligned: 2,
        missing_layers: ["internals", "macro"],
        last_transition_type: "improved",
        last_evaluated_at: new Date(Date.now() - 2 * 60_000).toISOString()
      }),
      undefined,
      COLORS
    );
    expect(model.attentionTier).toBe("getting_close");
    expect(model.blockers).toEqual(["Market Internals", "Macro"]);
    expect(model.progressionBadge).toBe("improved");
    expect(model.momentumLine).toContain("Building momentum");
  });

  test("5/6 actionable tier is check_now", () => {
    const model = buildWatchlistCardModel(
      "NVDA",
      row({ state: "actionable", layers_aligned: 5, layers_total: 6 }),
      undefined,
      COLORS
    );
    expect(model.attentionTier).toBe("check_now");
  });

  test("6/6 aligned readiness is not listed as a blocker", () => {
    const model = buildWatchlistCardModel(
      "DELL",
      row({
        state: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        progress_band: "actionable",
        readiness_label: "6/6 aligned"
      }),
      undefined,
      COLORS
    );
    expect(model.blockers).toEqual([]);
  });

  test("session closed overrides building momentum on card", () => {
    const model = buildWatchlistCardModel(
      "AMZN",
      row({
        state: "actionable",
        layers_aligned: 5,
        layers_total: 6,
        progress_band: "actionable",
        bias: "long",
        last_transition_type: "improved"
      }),
      undefined,
      COLORS,
      "swing",
      { regimeLabel: "Bullish", systemSuppressed: false, sessionMode: "closed" }
    );
    expect(model.momentumLine).toBe("Strong setup — session closed");
  });

  test("neutral 6/6 shows balanced copy not strong setup", () => {
    const model = buildWatchlistCardModel(
      "NVDA",
      row({
        state: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        progress_band: "actionable",
        bias: "neutral"
      }),
      undefined,
      COLORS,
      "swing",
      { regimeLabel: "Bullish", systemSuppressed: false, sessionMode: "closed" }
    );
    expect(model.alignmentLine).toBe("Balanced");
    expect(model.momentumLine).toBe("Balanced — session closed");
    expect(model.directionChip?.label).toBe("No edge");
    expect(model.chromeBadgeLabel).toBe("Balanced");
  });

  test("6/6 on bearish desk shows desk gated copy (not near actionable)", () => {
    const model = buildWatchlistCardModel(
      "AMD",
      row({
        state: "actionable",
        layers_aligned: 6,
        layers_total: 6,
        progress_band: "actionable",
        bias: "long"
      }),
      undefined,
      COLORS,
      "swing",
      { regimeLabel: "Bearish", systemSuppressed: true, sessionMode: "live" }
    );
    expect(model.alignmentLine).toContain("Strong");
    expect(model.momentumLine).toBe("Strong setup — desk gated (bearish regime)");
    expect(model.chromeKind).toBe("blocked");
    expect(model.borderLeft).toBe(COLORS.caution);
  });

  test("swing 6/6 closed session gets green plan chrome", () => {
    const model = buildWatchlistCardModel(
      "NVDA",
      row({ state: "actionable", layers_aligned: 6, layers_total: 6, bias: "long" }),
      undefined,
      COLORS,
      "swing",
      { regimeLabel: "Bullish", systemSuppressed: false, sessionMode: "closed" }
    );
    expect(model.chromeKind).toBe("actionable_plan");
    expect(model.chromeBadgeLabel).toBe("Plan");
    expect(model.borderLeft).toBe(COLORS.bullish);
  });

  test("short bias exposes direction chip without red border", () => {
    const model = buildWatchlistCardModel(
      "SPY",
      row({ state: "actionable", layers_aligned: 6, layers_total: 6, bias: "short" }),
      undefined,
      COLORS,
      "swing",
      { regimeLabel: "Bullish", systemSuppressed: false, sessionMode: "live" }
    );
    expect(model.directionChip?.label).toBe("↓ Short");
    expect(model.borderLeft).toBe(COLORS.bullish);
  });
});

describe("formatEvaluatedAgo", () => {
  test("marks stale after 45 minutes", () => {
    const iso = new Date(Date.now() - 50 * 60_000).toISOString();
    const { stale, text } = formatEvaluatedAgo(iso);
    expect(stale).toBe(true);
    expect(text).toMatch(/m ago|h ago/);
  });

  test("fresh within a few minutes", () => {
    const iso = new Date(Date.now() - 2 * 60_000).toISOString();
    const { stale, text } = formatEvaluatedAgo(iso);
    expect(stale).toBe(false);
    expect(text).toBe("2m ago");
  });
});

describe("groupSymbolsIntoAttentionTiers", () => {
  test("buckets symbols by tier", () => {
    const rowFor = (sym: string) => {
      if (sym === "NVDA") return row({ layers_aligned: 6, layers_total: 6, state: "actionable" });
      if (sym === "AMZN") return row({ layers_aligned: 3, layers_total: 6, state: "developing" });
      return row({ layers_aligned: 1, layers_total: 6, state: "not_aligned" });
    };
    const buckets = groupSymbolsIntoAttentionTiers(["NVDA", "AMZN", "SOFI"], rowFor);
    expect(buckets.check_now).toContain("NVDA");
    expect(buckets.getting_close).toContain("AMZN");
    expect(buckets.tracking).toContain("SOFI");
  });

  test("sorts check_now by alignment descending", () => {
    const rowFor = (sym: string) =>
      sym === "AAPL"
        ? row({ layers_aligned: 5, layers_total: 6, state: "actionable" })
        : row({ layers_aligned: 6, layers_total: 6, state: "actionable" });
    const sorted = sortSymbolsInAttentionTier(["AAPL", "NVDA"], rowFor);
    expect(sorted[0]).toBe("NVDA");
  });

  test("formatWatchlistTierHeaderHint includes near actionable preview", () => {
    const rowFor = (sym: string) =>
      sym === "NVDA"
        ? row({ layers_aligned: 4, layers_total: 6, state: "developing" })
        : row({ layers_aligned: 6, layers_total: 6, state: "actionable" });
    const hint = formatWatchlistTierHeaderHint("check_now", 2, rowFor, ["NVDA", "AAPL"]);
    expect(hint).toContain("2 symbols");
    expect(hint).toMatch(/near actionable|actionable/);
  });
});
