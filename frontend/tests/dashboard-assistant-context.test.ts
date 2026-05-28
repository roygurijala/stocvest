/**
 * Tier 1.C Phase 4 — versioned dashboard assistant page context builder.
 */

import { describe, expect, test } from "vitest";

import {
  buildDashboardAssistantPageContext,
  DASHBOARD_CONTEXT_VERSION
} from "@/lib/dashboard/dashboard-assistant-context";
import type { DeskTodayData } from "@/lib/api/desk-today";
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

  test("discovery_block_includes_desk_cache_fields", () => {
    const deskData: DeskTodayData = {
      generated_at: "2026-05-26T14:00:00Z",
      eligible_symbol_count: 88,
      discovery: [
        {
          symbol: "MU",
          gap_percent: 16,
          direction: "up",
          rank_score: 16,
          desk: "swing",
          verdict: "gap + catalyst"
        }
      ],
      recently_hot: [{ symbol: "AMD", dropped_at: "2026-05-26T13:00:00Z" }]
    };
    const ctx = buildDashboardAssistantPageContext({
      regimeLabel: "Risk-on",
      swingDeskPosture: "active",
      dayTradingSurfaces: false,
      daySetupsCount: 0,
      swingTopSignals: [],
      gapIntelligence: [],
      swingUniverseSymbolCount: 50,
      gapSnapshotSymbolCount: null,
      upcomingEarnings: [],
      scannerDataSettled: true,
      discoveryExpanded: false,
      activeDeskMode: "swing",
      deskData
    });
    expect(ctx.dashboard_context?.discovery.source).toBe("desk_cache");
    expect(ctx.dashboard_context?.discovery.scanned_count).toBe(88);
    expect(ctx.dashboard_context?.discovery.generated_at).toBe("2026-05-26T14:00:00Z");
    expect(ctx.dashboard_context?.discovery.recently_hot).toEqual(["AMD"]);
    expect(ctx.dashboard_context?.discovery.preview_symbols).toEqual(["MU"]);
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

  test("session_activity_lists_movers_radar_symbols", () => {
    const deskData: DeskTodayData = {
      movers_radar: [
        { symbol: "ASTC", gap_percent: 141.9, direction: "up", rank_score: 141.9 },
        { symbol: "ATPC", gap_percent: 110.7, direction: "up", rank_score: 110.7 }
      ]
    };
    const ctx = buildDashboardAssistantPageContext({
      regimeLabel: "Bullish",
      swingDeskPosture: "suppressed",
      dayTradingSurfaces: false,
      daySetupsCount: 0,
      swingTopSignals: [],
      gapIntelligence: [],
      swingUniverseSymbolCount: 50,
      gapSnapshotSymbolCount: null,
      upcomingEarnings: [],
      scannerDataSettled: true,
      discoveryExpanded: false,
      activeDeskMode: "swing",
      deskData
    });
    expect(ctx.dashboard_context?.discovery.source).toBe("movers_radar");
    expect(ctx.dashboard_context?.session_activity.count).toBe(2);
    expect(ctx.dashboard_context?.session_activity.symbols).toEqual(["ASTC", "ATPC"]);
    expect(ctx.dashboard_context?.session_activity.source).toBe("movers_radar");
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
