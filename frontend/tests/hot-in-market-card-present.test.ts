import { describe, expect, test } from "vitest";
import {
  buildHotInMarketCardModel,
  HOT_IN_MARKET_DISCLAIMER,
  hotInMarketAwaitingMessage,
  hotInMarketEmptyMessage,
  hotInMarketFeedSubtitle,
  hotInMarketSourceSubtitle
} from "@/lib/dashboard/hot-in-market-card-present";
import type { DeskDiscoveryLeader } from "@/lib/api/desk-today";

const colors = {
  surface: "#0f172a",
  border: "#334155",
  accent: "#38bdf8",
  bullish: "#4ade80",
  bearish: "#f87171",
  caution: "#fbbf24",
  textMuted: "#94a3b8"
};

function baseLeader(overrides: Partial<DeskDiscoveryLeader> = {}): DeskDiscoveryLeader {
  return {
    symbol: "MU",
    gap_percent: 16.2,
    direction: "up",
    rank_score: 16.2,
    desk: "swing",
    ...overrides
  };
}

describe("hot-in-market-card-present", () => {
  test("disclaimer states not a trade recommendation", () => {
    expect(HOT_IN_MARKET_DISCLAIMER.toLowerCase()).toContain("not trade recommendations");
    expect(HOT_IN_MARKET_DISCLAIMER.toLowerCase()).toContain("actionable");
  });

  test("blocked badge when execution hint mentions risk/reward", () => {
    const model = buildHotInMarketCardModel(
      baseLeader({
        execution_hint: "Strong setup quality — execution blocked by risk/reward (0.5:1)."
      }),
      { rank: 1, mode: "swing", source: "desk_cache", colors }
    );
    expect(model.setupBadge).toBe("blocked");
    expect(model.setupBadgeLabel).toBe("R/R blocks entry");
  });

  test("actionable badge when alignment and R/R meet swing gates", () => {
    const model = buildHotInMarketCardModel(
      baseLeader({
        alignment_ratio: 0.85,
        risk_reward: 2.4,
        composite_status: "monitor"
      }),
      { rank: 2, mode: "swing", source: "desk_cache", colors }
    );
    expect(model.setupBadge).toBe("actionable");
    expect(model.setupBadgeLabel).toBe("Meets our gates");
  });

  test("mover badge shows friction label for movers radar source", () => {
    const model = buildHotInMarketCardModel(baseLeader(), {
      rank: 3,
      mode: "day",
      source: "movers_radar",
      colors
    });
    expect(model.setupBadge).toBe("mover");
    expect(model.setupBadgeLabel).toMatch(/not an entry/i);
    expect(model.gapEmphasis).toBe("secondary");
    expect(model.statusHeadline).toMatch(/momentum/i);
    expect(model.cardTone).toBe("bullish");
    expect(model.alignmentLine).toBeNull();
  });

  test("hotInMarketSourceSubtitle describes desk cache", () => {
    expect(hotInMarketSourceSubtitle("desk_cache", 15)).toContain("platform desk");
  });

  test("pending badge when desk row lacks composite detail", () => {
    const model = buildHotInMarketCardModel(
      baseLeader({ alignment_ratio: undefined, verdict: null, execution_hint: null }),
      { rank: 10, mode: "day", source: "desk_cache", colors }
    );
    expect(model.setupBadge).toBe("pending");
    expect(model.setupBadgeLabel).toBe("Setup scan pending");
    expect(model.statusHeadline).toMatch(/desk scan/i);
  });

  test("hotInMarketFeedSubtitle shows loading when scanner pending", () => {
    const line = hotInMarketFeedSubtitle({
      source: "empty",
      count: 0,
      scannerPending: true,
      mode: "day"
    });
    expect(line.toLowerCase()).toContain("loading session movers");
  });

  test("hotInMarketFeedSubtitle suggests refresh on cache miss", () => {
    const line = hotInMarketFeedSubtitle({
      source: "empty",
      count: 0,
      deskCacheMiss: true,
      mode: "day"
    });
    expect(line.toLowerCase()).toContain("load movers");
  });

  test("hotInMarketSourceSubtitle describes movers radar in plain language", () => {
    const line = hotInMarketSourceSubtitle("movers_radar", 15);
    expect(line.toLowerCase()).not.toContain("math-only");
    expect(line.toLowerCase()).toContain("context only");
  });

  test("hotInMarketFeedSubtitle shows loading while session activity loads", () => {
    const line = hotInMarketFeedSubtitle({
      source: "empty",
      count: 0,
      deskCacheMiss: true,
      sessionActivityLoading: true,
      mode: "swing"
    });
    expect(line.toLowerCase()).toContain("loading session movers");
  });

  test("hotInMarketFeedSubtitle notes scanner still enriching when desk has movers", () => {
    const line = hotInMarketFeedSubtitle({
      source: "desk_cache",
      count: 3,
      scannerPending: true,
      mode: "day"
    });
    expect(line.toLowerCase()).toContain("scanner");
  });

  test("hotInMarketAwaitingMessage distinguishes cache miss", () => {
    const line = hotInMarketAwaitingMessage({ scannerPending: true, deskCacheMiss: true });
    expect(line.toLowerCase()).toContain("loading session movers");
  });

  test("hotInMarketEmptyMessage suggests refresh on cache miss", () => {
    expect(hotInMarketEmptyMessage(true).toLowerCase()).toContain("load movers");
  });
});
