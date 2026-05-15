import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("market API overview fetch", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchMarketOverview orchestrates status/snapshots/sparklines", async () => {
    const { fetchMarketOverview } = await import("@/lib/api/market");
    apiFetchMock.mockResolvedValueOnce({
      market: "open",
      exchanges: { nyse: "open" },
      currencies: { usd: "open" }
    });
    apiFetchMock.mockResolvedValueOnce({
      snapshots: [
        { symbol: "SPY", last_trade_price: 501.2 },
        { symbol: "QQQ", last_trade_price: 432.1 }
      ]
    });
    apiFetchMock.mockResolvedValueOnce({
      bars_by_symbol: {
        SPY: [{ close: 500 }, { close: 501 }],
        QQQ: [{ close: 430 }, { close: 432 }]
      }
    });

    const result = await fetchMarketOverview(["SPY", "QQQ"]);
    expect(result.error).toBeUndefined();
    expect(result.status?.market).toBe("open");
    expect(result.snapshots).toHaveLength(2);
    expect(result.news).toHaveLength(0);
    expect(result.sparklinesBySymbol?.SPY?.length).toBeGreaterThan(0);
    expect(result.sparklinesBySymbol?.QQQ?.length).toBeGreaterThan(0);
  });

  test("fetchMarketOverview handles API errors", async () => {
    const { fetchMarketOverview } = await import("@/lib/api/market");
    apiFetchMock.mockRejectedValue(new Error("API request failed (500): boom"));
    const result = await fetchMarketOverview();
    expect(result.error).toMatch(/500/);
    expect(result.snapshots).toHaveLength(0);
  });
});

describe("VIX snapshot helpers", () => {
  test("vixSnapshotDisplayLevel prefers last trade over day close", async () => {
    const {
      vixSnapshotDisplayLevel,
      vixSnapshotSessionChangePct,
      vixPulseDataAvailable
    } = await import("@/lib/api/market-snapshot-helpers");
    const s = {
      symbol: "I:VIX",
      last_trade_price: 18.2,
      day_close: 18.5,
      prev_close: 18.0
    };
    expect(vixSnapshotDisplayLevel(s)).toBe(18.2);
    expect(vixSnapshotSessionChangePct(s)).not.toBeNull();
    expect(vixPulseDataAvailable(s, null)).toBe(true);
  });

  test("vixSnapshotDisplayLevel falls back to day close for index-style gaps", async () => {
    const { vixSnapshotDisplayLevel, vixPulseDataAvailable, vixSnapshotSessionChangePct } = await import(
      "@/lib/api/market-snapshot-helpers"
    );
    const s = {
      symbol: "I:VIX",
      last_trade_price: null,
      day_close: 18.45,
      prev_close: 18.0
    };
    expect(vixSnapshotDisplayLevel(s)).toBe(18.45);
    expect(vixPulseDataAvailable(s, null)).toBe(true);
    const pct = vixSnapshotSessionChangePct(s);
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(0);
  });

  test("vixSnapshotDisplayLevel accepts string numbers from JSON", async () => {
    const { vixSnapshotDisplayLevel, vixPulseDataAvailable, vixSnapshotSessionChangePct } = await import(
      "@/lib/api/market-snapshot-helpers"
    );
    const s = {
      symbol: "I:VIX",
      last_trade_price: "18.42" as unknown as number,
      prev_close: "18.00" as unknown as number
    };
    expect(vixSnapshotDisplayLevel(s as never)).toBeCloseTo(18.42, 4);
    expect(vixPulseDataAvailable(s as never, null)).toBe(true);
    expect(vixSnapshotSessionChangePct(s as never)).not.toBeNull();
  });
});
