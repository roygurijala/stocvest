/**
 * Tier 1.C Phase 4 — versioned dashboard assistant page context builder.
 */

import { describe, expect, test } from "vitest";

import {
  buildDashboardAssistantPageContext,
  DASHBOARD_CONTEXT_VERSION
} from "@/lib/dashboard/dashboard-assistant-context";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";

const swingSetup: IntradaySetupPayload = {
  symbol: "AAA",
  direction: "long",
  score: 0.82,
  triggers: ["ema_cross"],
  timestamp_iso: "2026-05-15T14:00:00Z",
  scanner_mode: "swing_daily",
  is_confluence_alert: true
};

const gapUp: GapIntelligenceItem = {
  symbol: "GAP1",
  company_name: "Gap One",
  gap_pct: 3.2,
  gap_dollars: 1,
  prev_close: 50,
  current_price: 51.6,
  volume: 1_000_000,
  volume_vs_avg: 2,
  gap_quality_score: 85,
  catalyst: { category: "earnings", sentiment: "bullish", headline: "Beat", score: 1 },
  has_catalyst: true,
  no_catalyst_warning: null
};

describe("buildDashboardAssistantPageContext", () => {
  test("emits_versioned_dashboard_context_and_flat_dual_desk_fields", () => {
    const ctx = buildDashboardAssistantPageContext({
      regimeLabel: "Risk-on",
      swingDeskPosture: "active",
      dayDeskPosture: "monitor",
      daySetupsCount: 2,
      dayTradingSurfaces: true,
      swingTopSignals: [swingSetup],
      gapIntelligence: [gapUp],
      swingUniverseSymbolCount: 200,
      gapSnapshotSymbolCount: 150,
      upcomingEarnings: [
        {
          symbol: "AAPL",
          company_name: "Apple",
          report_date: "2026-05-20",
          report_time: "after_market"
        }
      ],
      scannerDataSettled: true,
      discoveryExpanded: false
    });

    expect(ctx.page).toBe("dashboard");
    expect(ctx.market_regime).toBe("Risk-on");
    expect(ctx.ranked_setups_count).toBe(1);
    expect(ctx.swing_desk_posture).toBe("active");
    expect(ctx.day_desk_posture).toBe("monitor");
    expect(ctx.day_setups_count).toBe(2);
    expect(ctx.top_setups?.[0]?.symbol).toBe("AAA");
    expect(ctx.dashboard_context?.version).toBe(DASHBOARD_CONTEXT_VERSION);
    expect(ctx.dashboard_context?.discovery.leader_count).toBe(1);
    expect(ctx.dashboard_context?.universe.swing_universe_symbol_count).toBe(200);
    expect(ctx.dashboard_context?.macro_events[0]?.symbol).toBe("AAPL");
    expect(ctx.dashboard_context?.gap_leaders_detail).toBeUndefined();
    expect(ctx).not.toHaveProperty("trading_mode");
  });

  test("includes_gap_leaders_detail_only_when_discovery_expanded", () => {
    const collapsed = buildDashboardAssistantPageContext({
      regimeLabel: "Neutral",
      swingDeskPosture: "suppressed",
      dayTradingSurfaces: false,
      daySetupsCount: 0,
      swingTopSignals: [],
      gapIntelligence: [gapUp],
      swingUniverseSymbolCount: 10,
      gapSnapshotSymbolCount: 10,
      upcomingEarnings: [],
      scannerDataSettled: true,
      discoveryExpanded: false
    });
    expect(collapsed.dashboard_context?.gap_leaders_detail).toBeUndefined();

    const expanded = buildDashboardAssistantPageContext({
      regimeLabel: "Neutral",
      swingDeskPosture: "suppressed",
      dayTradingSurfaces: false,
      daySetupsCount: 0,
      swingTopSignals: [],
      gapIntelligence: [gapUp],
      swingUniverseSymbolCount: 10,
      gapSnapshotSymbolCount: 10,
      upcomingEarnings: [],
      scannerDataSettled: true,
      discoveryExpanded: true
    });
    expect(expanded.dashboard_context?.gap_leaders_detail?.[0]?.symbol).toBe("GAP1");
  });

  test("omits_universe_counts_until_scanner_settles", () => {
    const ctx = buildDashboardAssistantPageContext({
      regimeLabel: "Neutral",
      swingDeskPosture: "suppressed",
      dayTradingSurfaces: false,
      daySetupsCount: 0,
      swingTopSignals: [],
      gapIntelligence: [gapUp],
      swingUniverseSymbolCount: 99,
      gapSnapshotSymbolCount: 88,
      upcomingEarnings: [],
      scannerDataSettled: false,
      discoveryExpanded: false
    });
    expect(ctx.dashboard_context?.discovery.leader_count).toBe(0);
    expect(ctx.dashboard_context?.universe.swing_universe_symbol_count).toBeNull();
    expect(ctx.dashboard_context?.universe.gap_snapshot_symbol_count).toBeNull();
  });
});
