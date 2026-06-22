import { describe, expect, test } from "vitest";

import type { SnapshotPayload } from "@/lib/api/market";
import { resolveSnapshotDisplayPrice } from "@/lib/api/snapshot-price";

describe("resolveSnapshotDisplayPrice", () => {
  test("prefers live last trade price", () => {
    const snap: SnapshotPayload = {
      symbol: "AAPL",
      last_trade_price: 201.5,
      day_close: 200,
      prev_close: 198
    };
    expect(resolveSnapshotDisplayPrice(snap)).toBe(201.5);
  });

  test("falls back to session close when no last print", () => {
    const snap: SnapshotPayload = { symbol: "SPY", day_close: 502.5, prev_close: 500 };
    expect(resolveSnapshotDisplayPrice(snap)).toBe(502.5);
  });

  test("weekend: last null and day_close 0 → prior (Friday) close", () => {
    // Mirrors live Polygon weekend payload (last_trade_price null, day.c = 0).
    const snap: SnapshotPayload = {
      symbol: "AAPL",
      last_trade_price: null,
      day_close: 0,
      prev_close: 298.01
    };
    expect(resolveSnapshotDisplayPrice(snap)).toBe(298.01);
  });

  test("returns null when nothing positive is available", () => {
    expect(resolveSnapshotDisplayPrice({ symbol: "X", day_close: 0, prev_close: 0 })).toBeNull();
    expect(resolveSnapshotDisplayPrice(null)).toBeNull();
    expect(resolveSnapshotDisplayPrice(undefined)).toBeNull();
  });
});
