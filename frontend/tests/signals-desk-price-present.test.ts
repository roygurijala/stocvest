import { describe, expect, test } from "vitest";
import { buildSignalsDeskPriceContext } from "@/lib/signals-desk-price-present";
import type { SnapshotPayload } from "@/lib/api/market";

describe("buildSignalsDeskPriceContext", () => {
  test("shows last price and session change from snapshot fields", () => {
    const snapshot: SnapshotPayload = {
      symbol: "AAPL",
      last_trade_price: 185.2,
      prev_close: 183,
      change_percent: 1.2
    };
    const ctx = buildSignalsDeskPriceContext(snapshot);
    expect(ctx).not.toBeNull();
    expect(ctx?.priceLabel).toBe("Last");
    expect(ctx?.priceFormatted).toBe("$185.20");
    expect(ctx?.dayChangeFormatted).toBe("+1.2%");
    expect(ctx?.dayChangeTone).toBe("up");
  });

  test("falls back to day close with As of close label", () => {
    const snapshot: SnapshotPayload = {
      symbol: "SPY",
      day_close: 502.5,
      prev_close: 500
    };
    const ctx = buildSignalsDeskPriceContext(snapshot);
    expect(ctx?.priceLabel).toBe("As of close");
    expect(ctx?.priceFormatted).toBe("$502.50");
    expect(ctx?.dayChangeFormatted).toBe("+0.5%");
  });

  test("returns null when no usable price", () => {
    expect(buildSignalsDeskPriceContext(null)).toBeNull();
    expect(buildSignalsDeskPriceContext({ symbol: "X" })).toBeNull();
  });
});
