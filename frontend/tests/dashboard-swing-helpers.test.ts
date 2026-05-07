import { describe, expect, it } from "vitest";
import { pctChangeOverDailySessions } from "@/lib/session-return-math";
import { swingStylePatternLine } from "@/lib/scanner-swing-triggers";
import { buildDashboardSignalCardStrip } from "@/lib/dashboard-signal-card-strip";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { SnapshotPayload } from "@/lib/api/market";
import type { EarningsEvent } from "@/lib/api/earnings";

describe("pctChangeOverDailySessions", () => {
  it("computes ~5 session return", () => {
    const closes = [100, 101, 102, 100, 99, 105];
    const pct = pctChangeOverDailySessions(closes, 5);
    expect(pct).not.toBeNull();
    expect(pct).toBeCloseTo(5, 5);
  });
});

describe("swingStylePatternLine", () => {
  it("maps ORB + EMA to swing-readable headline", () => {
    const s = swingStylePatternLine(["orb_breakout_long", "ema9_bounce"]);
    expect(s).toContain("Trend continuation");
    expect(s).toContain("Pullback");
  });
});

describe("buildDashboardSignalCardStrip", () => {
  it("formats stop/target and catalyst from earnings", () => {
    const setup: IntradaySetupPayload = {
      symbol: "TEST",
      direction: "long",
      score: 0.72,
      triggers: ["orb_breakout_long"],
      timestamp_iso: new Date().toISOString(),
      last_price: 100
    };
    const snap: SnapshotPayload = {
      symbol: "TEST",
      last_trade_price: 100,
      prev_close: 98,
      day_low: 97,
      day_high: 101,
      day_vwap: 99.5
    };
    const recent: EarningsEvent[] = [
      {
        symbol: "TEST",
        company_name: "Test Co",
        report_date: "2026-04-30",
        report_time: "after_market",
        estimated_eps: 1.0,
        actual_eps: 1.2,
        surprise_percent: 5,
        market_cap: null
      }
    ];
    const strip = buildDashboardSignalCardStrip(setup, snap, { upcoming: [], recent });
    expect(strip.swingDailyDetailLine).toBeNull();
    expect(strip.stopTargetLine).toMatch(/Stop \$[\d.]+ · Target \$[\d.]+/);
    expect(strip.catalystLine).toMatch(/Earnings beat/);
  });

  it("surfaces daily swing scanner metrics when scanner_mode is swing_daily", () => {
    const setup: IntradaySetupPayload = {
      symbol: "SWING",
      direction: "long",
      score: 0.88,
      triggers: ["ema50_cross_above_200", "weekly_rsi_recovery"],
      timestamp_iso: "2026-05-01T20:00:00+00:00",
      last_price: 50,
      scanner_mode: "swing_daily",
      ema_daily_crossovers: ["ema50_cross_above_200"],
      weekly_rsi_recovery: true,
      weekly_rsi: 44,
      volume_expansion_ratio: 1.55,
      pattern_maturity_days: 3
    };
    const strip = buildDashboardSignalCardStrip(setup, undefined, { upcoming: [], recent: [] });
    expect(strip.swingDailyDetailLine).toContain("Daily EMA");
    expect(strip.swingDailyDetailLine).toContain("Weekly RSI recovery");
    expect(strip.swingDailyDetailLine).toContain("Vol vs 20D");
    expect(strip.maturityLine).toContain("Pattern maturity: 3 sessions");
  });
});
