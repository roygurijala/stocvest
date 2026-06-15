import { describe, expect, test } from "vitest";
import {
  feedCardAllowsScenarioGeometry,
  isMoverFeedCard
} from "@/lib/dashboard/trading-room/feed-setup-tier";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";

function card(setupTier: FeedCard["setupTier"]): FeedCard {
  return {
    id: "day:UBXG",
    symbol: "UBXG",
    company: null,
    lane: "day",
    state: "potential",
    bias: "bull",
    verdict: "Session mover — desk cache warming.",
    phase: "session activity",
    price: 8.5,
    changePct: 27.4,
    alignment: null,
    rankScore: 88,
    source: "desk",
    setupTier
  };
}

describe("feed-setup-tier", () => {
  test("mover cards are blocked from scenario geometry", () => {
    const mover = card("mover");
    expect(isMoverFeedCard(mover)).toBe(true);
    expect(feedCardAllowsScenarioGeometry(mover)).toBe(false);
  });

  test("setup cards allow scenario geometry", () => {
    const setup = card("setup");
    expect(isMoverFeedCard(setup)).toBe(false);
    expect(feedCardAllowsScenarioGeometry(setup)).toBe(true);
  });
});
