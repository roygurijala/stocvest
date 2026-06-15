import { describe, expect, test } from "vitest";
import { resolveDeepDiveUnavailableMessage } from "@/lib/dashboard/trading-room/composite-unavailable-present";

describe("resolveDeepDiveUnavailableMessage", () => {
  test("prefers transport error message", () => {
    const msg = resolveDeepDiveUnavailableMessage({
      symbol: "ASTN",
      cardVerdict: "Monitoring conditions",
      composite: null,
      transportError: {
        code: "timeout",
        message: "Signal analysis timed out. Try again in a moment."
      },
      fetchErrorMessage: null
    });
    expect(msg).toContain("timed out");
  });

  test("surfaces liquidity_filtered backend copy", () => {
    const msg = resolveDeepDiveUnavailableMessage({
      symbol: "PENNY",
      cardVerdict: "Monitoring",
      composite: {
        status: "liquidity_filtered",
        message: "Symbol does not meet minimum universe eligibility for swing evaluation (price_below_5).",
        market_status: { is_market_open: true, next_open: null, market_session: "regular" }
      },
      transportError: null,
      fetchErrorMessage: null
    });
    expect(msg).toContain("universe eligibility");
  });

  test("falls back to card verdict when composite is thin", () => {
    const msg = resolveDeepDiveUnavailableMessage({
      symbol: "ASTN",
      cardVerdict: "Session mover · not an entry",
      composite: null,
      transportError: null,
      fetchErrorMessage: null
    });
    expect(msg).toBe("Session mover · not an entry");
  });
});
