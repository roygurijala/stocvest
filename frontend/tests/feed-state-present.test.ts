import { describe, expect, it } from "vitest";
import { feedCardStateLabel } from "@/lib/dashboard/trading-room/feed-state-present";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";

function card(partial: Partial<FeedCard>): FeedCard {
  return {
    id: "swing:TEST",
    symbol: "TEST",
    company: null,
    lane: "swing",
    state: "actionable",
    bias: "bull",
    verdict: "",
    phase: null,
    price: 100,
    changePct: 1,
    alignment: null,
    rankScore: 80,
    source: "desk",
    setupTier: "setup",
    ...partial
  };
}

describe("feedCardStateLabel", () => {
  it("maps actionable to valid setup by default", () => {
    expect(feedCardStateLabel(card({ state: "actionable" }))).toBe("Valid setup");
  });

  it("surfaces timing caution from verdict", () => {
    expect(
      feedCardStateLabel(card({ state: "actionable", verdict: "Execution blocked by risk/reward" }))
    ).toBe("Valid setup · timing caution");
  });
});
