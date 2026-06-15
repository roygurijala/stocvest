import { describe, expect, test } from "vitest";

import {
  overlayFeedCardTimestamps,
  resolveFeedCardLastEvaluatedAt
} from "@/lib/dashboard/trading-room/feed-card-timestamps";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";

const baseCard: FeedCard = {
  id: "swing:AAPL",
  symbol: "AAPL",
  company: null,
  lane: "swing",
  state: "near",
  bias: "bull",
  verdict: "test",
  phase: null,
  price: null,
  changePct: null,
  alignment: null,
  rankScore: 0,
  source: "desk",
  setupTier: "setup"
};

describe("resolveFeedCardLastEvaluatedAt", () => {
  test("prefers maturation row over desk generated_at", () => {
    const iso = "2026-06-08T14:00:00.000Z";
    const at = resolveFeedCardLastEvaluatedAt(baseCard, {
      swingBySymbol: { AAPL: { last_evaluated_at: iso } },
      swingDeskGeneratedAt: "2026-06-08T12:00:00.000Z"
    });
    expect(at).toBe(iso);
  });

  test("falls back to desk generated_at", () => {
    const deskIso = "2026-06-08T12:00:00.000Z";
    const at = resolveFeedCardLastEvaluatedAt(baseCard, {
      swingBySymbol: {},
      swingDeskGeneratedAt: deskIso
    });
    expect(at).toBe(deskIso);
  });
});

describe("overlayFeedCardTimestamps", () => {
  test("maps lastEvaluatedAt onto each card", () => {
    const deskIso = "2026-06-08T12:00:00.000Z";
    const out = overlayFeedCardTimestamps([baseCard], {
      swingBySymbol: {},
      swingDeskGeneratedAt: deskIso
    });
    expect(out[0]?.lastEvaluatedAt).toBe(deskIso);
  });
});
